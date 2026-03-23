/**
 * Phase 3 Revenue Engine - Complete Pipeline Runner
 * Orchestrates the full PROSPECT → PITCH → PRODUCE → DELIVER pipeline
 * Manages stage transitions, approval queues, error handling, and activity logging
 */

const fs = require('fs');
const path = require('path');
const { Orchestrator, JOB_STATES } = require('../orchestrator');
const logger = require('./logger');
const { getTokenTracker } = require('./tokenTracker');

class PipelineRunner {
  constructor(orchestrator, apiClient, config = {}) {
    if (!(orchestrator instanceof Orchestrator)) {
      throw new Error('Invalid orchestrator provided to PipelineRunner');
    }

    this.orchestrator = orchestrator;
    this.apiClient = apiClient;
    this.config = config;
    this.tokenTracker = getTokenTracker();
    this.approvalQueues = {
      opportunities: [],
      proposals: [],
      content: []
    };
    this.activityLog = [];
    this.pipelineMetrics = {
      prospectStage: { processed: 0, qualified: 0, failed: 0 },
      pitchStage: { processed: 0, submitted: 0, failed: 0 },
      produceStage: { processed: 0, approved: 0, failed: 0 },
      deliverStage: { processed: 0, completed: 0, failed: 0 }
    };
  }

  /**
   * ========== PROSPECT STAGE ==========
   * Research agent discovers opportunities
   * Opportunity scorer evaluates fit
   * High-scoring opportunities added to approval queue
   */

  async processPROSPECT(opportunity) {
    const startTime = new Date();
    const opportunityId = opportunity.id || `opp_${Date.now()}`;

    try {
      this._logActivity('PROSPECT_START', {
        opportunityId,
        title: opportunity.title,
        niche: opportunity.niche,
        budget: opportunity.budget?.amount || 0
      });

      // Step 1: Validate opportunity data
      if (!this._validateOpportunity(opportunity)) {
        throw new Error('Invalid opportunity data structure');
      }

      // Step 2: Score the opportunity using AI
      const scoreResult = await this._scoreOpportunity(opportunity);
      opportunity.score = scoreResult.score;
      opportunity.scoreBreakdown = scoreResult.breakdown;
      opportunity.scoredAt = new Date();

      this._logActivity('OPPORTUNITY_SCORED', {
        opportunityId,
        score: scoreResult.score,
        qualifies: scoreResult.qualifies
      });

      // Step 3: If high-scoring, add to approval queue
      if (scoreResult.qualifies) {
        const approvalItem = {
          id: opportunityId,
          type: 'opportunity',
          opportunity,
          score: scoreResult.score,
          addedToQueueAt: new Date(),
          status: 'pending_owner_approval',
          metadata: {
            scoringDetails: scoreResult.breakdown,
            estimatedValue: scoreResult.estimatedValue
          }
        };

        this.approvalQueues.opportunities.push(approvalItem);

        this._logActivity('OPPORTUNITY_APPROVED_FOR_QUEUE', {
          opportunityId,
          score: scoreResult.score,
          estimatedValue: scoreResult.estimatedValue,
          queuePosition: this.approvalQueues.opportunities.length
        });

        this.pipelineMetrics.prospectStage.qualified++;

        return {
          success: true,
          stage: 'PROSPECT',
          status: 'qualified_pending_approval',
          opportunityId,
          approvalId: opportunityId,
          score: scoreResult.score,
          processingTime: new Date() - startTime
        };
      } else {
        this.pipelineMetrics.prospectStage.failed++;

        return {
          success: true,
          stage: 'PROSPECT',
          status: 'rejected_low_score',
          opportunityId,
          score: scoreResult.score,
          reason: scoreResult.rejectionReason,
          processingTime: new Date() - startTime
        };
      }
    } catch (error) {
      this.pipelineMetrics.prospectStage.failed++;
      this._logActivity('PROSPECT_ERROR', {
        opportunityId,
        error: error.message,
        stack: error.stack
      });

      logger.error(`PROSPECT stage failed for opportunity ${opportunityId}: ${error.message}`);
      throw error;
    } finally {
      this.pipelineMetrics.prospectStage.processed++;
    }
  }

  /**
   * ========== PITCH STAGE ==========
   * Owner approves opportunity
   * Proposal Writer generates proposal
   * Owner approves proposal
   * Submit to client
   */

  async processPITCH(approvalId) {
    const startTime = new Date();

    try {
      // Step 1: Get approved opportunity from queue
      const approvalItem = this.approvalQueues.opportunities.find(item => item.id === approvalId);
      if (!approvalItem) {
        throw new Error(`Approval item not found: ${approvalId}`);
      }

      const opportunity = approvalItem.opportunity;

      this._logActivity('PITCH_START', {
        opportunityId: opportunity.id,
        title: opportunity.title,
        clientName: opportunity.client?.name
      });

      // Step 2: Generate proposal using Proposal Writer agent
      const proposal = await this._generateProposal(opportunity);
      proposal.opportunityId = opportunity.id;
      proposal.createdAt = new Date();
      proposal.status = 'draft';

      // Step 3: Add to proposal approval queue
      const proposalApprovalItem = {
        id: `prop_${Date.now()}`,
        type: 'proposal',
        proposal,
        opportunityId: opportunity.id,
        addedToQueueAt: new Date(),
        status: 'pending_owner_approval',
        metadata: {
          proposalGeneratedAt: proposal.createdAt,
          clientName: opportunity.client?.name
        }
      };

      this.approvalQueues.proposals.push(proposalApprovalItem);

      this._logActivity('PROPOSAL_GENERATED', {
        proposalId: proposalApprovalItem.id,
        opportunityId: opportunity.id,
        estimatedValue: proposal.pricing?.total || 0
      });

      return {
        success: true,
        stage: 'PITCH',
        status: 'proposal_generated_pending_approval',
        proposalId: proposalApprovalItem.id,
        opportunityId: opportunity.id,
        proposal,
        processingTime: new Date() - startTime
      };
    } catch (error) {
      this.pipelineMetrics.pitchStage.failed++;
      this._logActivity('PITCH_ERROR', {
        approvalId,
        error: error.message,
        stack: error.stack
      });

      logger.error(`PITCH stage failed for approval ${approvalId}: ${error.message}`);
      throw error;
    } finally {
      this.pipelineMetrics.pitchStage.processed++;
    }
  }

  async submitProposal(proposalApprovalId) {
    const startTime = new Date();

    try {
      const proposalItem = this.approvalQueues.proposals.find(
        item => item.id === proposalApprovalId
      );

      if (!proposalItem) {
        throw new Error(`Proposal approval item not found: ${proposalApprovalId}`);
      }

      const proposal = proposalItem.proposal;

      this._logActivity('PROPOSAL_SUBMIT_START', {
        proposalId: proposalApprovalId,
        opportunityId: proposal.opportunityId
      });

      // Submit to client (simulated)
      proposal.status = 'submitted';
      proposal.submittedAt = new Date();

      // Remove from approval queue and create job for tracking
      this.approvalQueues.proposals = this.approvalQueues.proposals.filter(
        item => item.id !== proposalApprovalId
      );

      // Create job object for orchestrator to track through production
      const job = {
        id: `job_${Date.now()}`,
        type: 'content_production',
        state: JOB_STATES.BRIEFED,
        priority: 50,
        deadline: proposal.deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        data: {
          opportunityId: proposal.opportunityId,
          proposalId: proposalApprovalId,
          proposal,
          clientName: proposal.clientName,
          requirements: proposal.requirements,
          deliverables: proposal.deliverables
        },
        createdAt: new Date(),
        retryCount: 0
      };

      // Route through orchestrator
      await this.orchestrator.routeJob(job);

      this._logActivity('PROPOSAL_SUBMITTED', {
        proposalId: proposalApprovalId,
        jobId: job.id,
        clientName: proposal.clientName
      });

      this.pipelineMetrics.pitchStage.submitted++;

      return {
        success: true,
        stage: 'PITCH',
        status: 'proposal_submitted',
        proposalId: proposalApprovalId,
        jobId: job.id,
        processingTime: new Date() - startTime
      };
    } catch (error) {
      this.pipelineMetrics.pitchStage.failed++;
      this._logActivity('PROPOSAL_SUBMIT_ERROR', {
        proposalApprovalId,
        error: error.message
      });

      logger.error(`Proposal submission failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * ========== PRODUCE STAGE ==========
   * Client Brief agent structures requirements
   * Writer drafts content
   * Editor reviews
   * Humanization pass
   * Quality Gate scores
   * Loop back if below threshold
   * Surface for owner approval if passed
   */

  async processPRODUCE(job) {
    const startTime = new Date();

    try {
      this._logActivity('PRODUCE_START', {
        jobId: job.id,
        state: job.state,
        clientName: job.data?.clientName
      });

      // Step 1: Client Brief - Structure requirements
      const briefResult = await this._structureClientBrief(job.data);
      job.data.briefStructure = briefResult;

      await this.orchestrator.transitionJob(job, JOB_STATES.WRITING, {
        briefCreated: true,
        briefId: briefResult.id
      });

      this._logActivity('CLIENT_BRIEF_CREATED', {
        jobId: job.id,
        briefId: briefResult.id
      });

      // Step 2: Writing - Draft content
      const draftResult = await this._generateContent(job.data);
      job.data.draft = draftResult;
      job.data.draftIterations = job.data.draftIterations || [];
      job.data.draftIterations.push({
        version: 1,
        content: draftResult.content,
        createdAt: new Date(),
        feedback: null
      });

      await this.orchestrator.transitionJob(job, JOB_STATES.EDITING, {
        draftCreated: true,
        wordCount: draftResult.wordCount
      });

      this._logActivity('DRAFT_CREATED', {
        jobId: job.id,
        wordCount: draftResult.wordCount,
        version: 1
      });

      // Step 3: Editing - Review draft
      const editResult = await this._editContent(job.data.draft);
      job.data.editingFeedback = editResult;

      await this.orchestrator.transitionJob(job, JOB_STATES.HUMANIZING, {
        editingComplete: true,
        feedbackItems: editResult.feedbackItems.length
      });

      this._logActivity('CONTENT_EDITED', {
        jobId: job.id,
        feedbackItems: editResult.feedbackItems.length
      });

      // Step 4: Humanization pass - Add human touch
      const humanizedResult = await this._humanizeContent(
        job.data.draft.content,
        editResult
      );
      job.data.humanized = humanizedResult;

      await this.orchestrator.transitionJob(job, JOB_STATES.QUALITY_CHECK, {
        humanizationComplete: true
      });

      this._logActivity('CONTENT_HUMANIZED', {
        jobId: job.id,
        changesApplied: humanizedResult.changesApplied
      });

      // Step 5: Quality Gate - Score content
      const qualityResult = await this._performQualityGate(
        job.data.humanized.content
      );
      job.data.qualityScore = qualityResult.score;
      job.data.qualityChecks = qualityResult.checks;

      this._logActivity('QUALITY_GATE_COMPLETE', {
        jobId: job.id,
        score: qualityResult.score,
        passed: qualityResult.passed
      });

      // Step 6: Quality threshold check - Loop back if needed
      const qualityThreshold = this.config.qualityThreshold || 3;

      if (!qualityResult.passed) {
        // Add to retry loop
        const iteration = job.data.draftIterations.length + 1;

        if (iteration <= 3) {
          // Max 3 iterations
          this._logActivity('QUALITY_THRESHOLD_FAILED', {
            jobId: job.id,
            score: qualityResult.score,
            threshold: qualityThreshold,
            iteration,
            feedback: qualityResult.feedback
          });

          // Loop back to writing with feedback
          const retryResult = await this._generateContent(job.data, {
            previousFeedback: qualityResult.feedback,
            iteration
          });

          job.data.draftIterations.push({
            version: iteration,
            content: retryResult.content,
            createdAt: new Date(),
            feedback: qualityResult.feedback
          });

          job.data.draft = retryResult;

          // Re-run editing and humanization
          const retryEditResult = await this._editContent(job.data.draft);
          const retryHumanizeResult = await this._humanizeContent(
            job.data.draft.content,
            retryEditResult
          );
          const retryQualityResult = await this._performQualityGate(
            retryHumanizeResult.content
          );

          job.data.qualityScore = retryQualityResult.score;
          job.data.qualityChecks = retryQualityResult.checks;

          this._logActivity('QUALITY_GATE_RETRY', {
            jobId: job.id,
            iteration,
            newScore: retryQualityResult.score,
            passed: retryQualityResult.passed
          });

          if (!retryQualityResult.passed && iteration === 3) {
            // Final attempt failed - escalate
            throw new Error(
              `Quality threshold not met after ${iteration} iterations. Score: ${retryQualityResult.score}`
            );
          }
        } else {
          throw new Error('Maximum quality iterations exceeded');
        }
      }

      // Step 7: Quality passed - Add to content approval queue
      const contentApprovalItem = {
        id: `content_${Date.now()}`,
        type: 'content',
        jobId: job.id,
        content: job.data.humanized.content,
        qualityScore: job.data.qualityScore,
        addedToQueueAt: new Date(),
        status: 'pending_owner_approval',
        metadata: {
          iterations: job.data.draftIterations.length,
          wordCount: job.data.draft.wordCount,
          clientName: job.data.clientName
        }
      };

      this.approvalQueues.content.push(contentApprovalItem);

      await this.orchestrator.transitionJob(job, JOB_STATES.APPROVED_CONTENT, {
        qualityPassed: true,
        score: job.data.qualityScore,
        contentId: contentApprovalItem.id
      });

      this._logActivity('CONTENT_READY_FOR_APPROVAL', {
        jobId: job.id,
        contentId: contentApprovalItem.id,
        score: job.data.qualityScore,
        queuePosition: this.approvalQueues.content.length
      });

      this.pipelineMetrics.produceStage.approved++;

      return {
        success: true,
        stage: 'PRODUCE',
        status: 'content_approved_pending_owner_review',
        jobId: job.id,
        contentId: contentApprovalItem.id,
        qualityScore: job.data.qualityScore,
        processingTime: new Date() - startTime
      };
    } catch (error) {
      this.pipelineMetrics.produceStage.failed++;
      this._logActivity('PRODUCE_ERROR', {
        jobId: job.id,
        error: error.message,
        stack: error.stack
      });

      logger.error(`PRODUCE stage failed for job ${job.id}: ${error.message}`);
      await this.orchestrator.handleJobFailure(job, error);
      throw error;
    } finally {
      this.pipelineMetrics.produceStage.processed++;
    }
  }

  /**
   * ========== DELIVER STAGE ==========
   * Owner approves content
   * Delivery agent sends in client format
   * Portfolio agent evaluates for samples
   * Strategy agent logs outcomes
   * Accounting agent records financials
   */

  async processDELIVER(contentApprovalId, job) {
    const startTime = new Date();

    try {
      const contentItem = this.approvalQueues.content.find(
        item => item.id === contentApprovalId
      );

      if (!contentItem) {
        throw new Error(`Content approval item not found: ${contentApprovalId}`);
      }

      this._logActivity('DELIVER_START', {
        jobId: job.id,
        contentId: contentApprovalId,
        clientName: job.data?.clientName
      });

      // Step 1: Delivery agent - Format and send to client
      const deliveryResult = await this._deliverContent(
        contentItem.content,
        job.data
      );

      job.data.delivery = deliveryResult;

      await this.orchestrator.transitionJob(job, JOB_STATES.DELIVERING, {
        contentDelivered: true,
        deliveryId: deliveryResult.id
      });

      this._logActivity('CONTENT_DELIVERED', {
        jobId: job.id,
        deliveryId: deliveryResult.id,
        format: deliveryResult.format,
        clientEmail: deliveryResult.sentTo
      });

      // Step 2: Portfolio agent - Evaluate for case study samples
      const portfolioResult = await this._evaluateForPortfolio(job.data);
      job.data.portfolioEvaluation = portfolioResult;

      if (portfolioResult.qualifies) {
        this._logActivity('PORTFOLIO_SAMPLE_CAPTURED', {
          jobId: job.id,
          title: portfolioResult.title,
          niche: job.data.niche
        });
      }

      // Step 3: Strategy agent - Log outcomes and lessons
      const strategyResult = await this._logOutcomes(job.data, portfolioResult);
      job.data.strategyInsights = strategyResult;

      this._logActivity('OUTCOMES_LOGGED', {
        jobId: job.id,
        insights: strategyResult.keyInsights
      });

      // Step 4: Accounting agent - Record financials
      const accountingResult = await this._recordFinancials(job.data);
      job.data.financials = accountingResult;

      this._logActivity('FINANCIALS_RECORDED', {
        jobId: job.id,
        revenue: accountingResult.revenue,
        cost: accountingResult.cost,
        profit: accountingResult.profit
      });

      // Remove from approval queue
      this.approvalQueues.content = this.approvalQueues.content.filter(
        item => item.id !== contentApprovalId
      );

      // Mark job complete
      await this.orchestrator.transitionJob(job, JOB_STATES.DELIVERED, {
        allDeliveriesComplete: true,
        financialsSummary: accountingResult
      });

      this._logActivity('DELIVERY_COMPLETE', {
        jobId: job.id,
        revenue: accountingResult.revenue,
        profit: accountingResult.profit
      });

      this.pipelineMetrics.deliverStage.completed++;

      return {
        success: true,
        stage: 'DELIVER',
        status: 'delivery_complete',
        jobId: job.id,
        deliveryId: deliveryResult.id,
        revenue: accountingResult.revenue,
        profit: accountingResult.profit,
        portfolioIncluded: portfolioResult.qualifies,
        processingTime: new Date() - startTime
      };
    } catch (error) {
      this.pipelineMetrics.deliverStage.failed++;
      this._logActivity('DELIVER_ERROR', {
        jobId: job.id,
        error: error.message,
        stack: error.stack
      });

      logger.error(`DELIVER stage failed for job ${job.id}: ${error.message}`);
      throw error;
    } finally {
      this.pipelineMetrics.deliverStage.processed++;
    }
  }

  /**
   * ========== INTERNAL HELPER METHODS ==========
   */

  _validateOpportunity(opportunity) {
    return (
      opportunity &&
      opportunity.id &&
      opportunity.title &&
      opportunity.niche &&
      opportunity.budget &&
      opportunity.client
    );
  }

  async _scoreOpportunity(opportunity) {
    try {
      // Simulate scoring (in production, use AI via apiClient)
      const scoring = {
        nicheMatch: this._evaluateNicheMatch(opportunity.niche),
        budgetScore: this._evaluateBudget(opportunity.budget),
        clientScore: this._evaluateClientReputation(opportunity.client),
        skillsMatch: 0.8
      };

      const totalScore = (
        (scoring.nicheMatch * 0.3) +
        (scoring.budgetScore * 0.3) +
        (scoring.clientScore * 0.2) +
        (scoring.skillsMatch * 0.2)
      ) * 5;

      const qualifies = totalScore >= 3.5;
      const estimatedValue = opportunity.budget?.amount || 0;

      return {
        score: parseFloat(totalScore.toFixed(2)),
        qualifies,
        breakdown: scoring,
        estimatedValue,
        rejectionReason: qualifies ? null : 'Score below threshold'
      };
    } catch (error) {
      logger.error(`Scoring error: ${error.message}`);
      throw error;
    }
  }

  _evaluateNicheMatch(niche) {
    const focusNiches = this.config.focusNiches || ['HR', 'PEO', 'benefits', 'compliance'];
    return focusNiches.includes(niche) ? 1.0 : 0.6;
  }

  _evaluateBudget(budget) {
    const amount = budget?.amount || 0;
    if (amount >= 2000) return 1.0;
    if (amount >= 1000) return 0.8;
    if (amount >= 500) return 0.6;
    return 0.3;
  }

  _evaluateClientReputation(client) {
    const rating = client?.rating || 0;
    return Math.min(rating / 5, 1.0);
  }

  async _generateProposal(opportunity) {
    // Simulated proposal generation
    return {
      id: `prop_${Date.now()}`,
      opportunityId: opportunity.id,
      clientName: opportunity.client?.name,
      title: `Proposal: ${opportunity.title}`,
      executive_summary: `Professional proposal response to ${opportunity.title}`,
      requirements: opportunity.description,
      deliverables: [
        'Initial brief and planning',
        'Content creation',
        'Revisions (up to 2 rounds)',
        'Final delivery'
      ],
      timeline: {
        start: new Date(),
        end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      pricing: {
        base: opportunity.budget?.amount || 1500,
        revisions: 0,
        total: opportunity.budget?.amount || 1500
      },
      terms: 'Payment upon delivery, revisions included in timeline',
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    };
  }

  async _structureClientBrief(jobData) {
    // Parse and structure brief information
    return {
      id: `brief_${Date.now()}`,
      clientName: jobData.clientName,
      projectTitle: jobData.proposal?.title,
      requirements: jobData.proposal?.requirements || jobData.requirements,
      deliverables: jobData.proposal?.deliverables || [],
      timeline: jobData.proposal?.timeline,
      constraints: [],
      objectives: ['Create high-quality content', 'Meet client specifications', 'On-time delivery'],
      structuredAt: new Date()
    };
  }

  async _generateContent(jobData, options = {}) {
    // Simulated content generation
    const wordCount = options.wordCount || 2000;
    const iteration = options.iteration || 1;

    return {
      id: `draft_${Date.now()}`,
      version: iteration,
      content: `Generated content for ${jobData.clientName}. Version ${iteration}. [${wordCount} words of quality content]`,
      wordCount,
      tone: 'professional',
      createdAt: new Date()
    };
  }

  async _editContent(draft) {
    // Simulated editing
    return {
      id: `edit_${Date.now()}`,
      draftId: draft.id,
      feedbackItems: [
        { type: 'clarity', location: 'paragraph 2', suggestion: 'Improve clarity' },
        { type: 'flow', location: 'section 3', suggestion: 'Better transition needed' }
      ],
      overallFeedback: 'Strong draft with minor improvements needed',
      editedAt: new Date()
    };
  }

  async _humanizeContent(content, editingFeedback) {
    // Simulate humanization pass
    return {
      id: `humanize_${Date.now()}`,
      originalContent: content,
      content: `${content} [Enhanced with human touch, conversational elements, and improved readability]`,
      changesApplied: 3,
      improvements: [
        'Added conversational transitions',
        'Improved readability',
        'Added relatable examples'
      ],
      humanizedAt: new Date()
    };
  }

  async _performQualityGate(content) {
    // Simulate quality checks
    const checks = {
      grammar: 5,
      clarity: 4,
      relevance: 5,
      completeness: 4,
      clientFit: 5
    };

    const score = (
      (checks.grammar +
        checks.clarity +
        checks.relevance +
        checks.completeness +
        checks.clientFit) /
      5
    ) / 5 * 5;

    const qualityThreshold = this.config.qualityThreshold || 3;
    const passed = score >= qualityThreshold;

    return {
      id: `qa_${Date.now()}`,
      score: parseFloat(score.toFixed(2)),
      checks,
      passed,
      feedback: passed
        ? 'Content meets quality standards'
        : 'Content needs improvement in: clarity, completeness',
      checkedAt: new Date()
    };
  }

  async _deliverContent(content, jobData) {
    // Simulated delivery
    return {
      id: `delivery_${Date.now()}`,
      jobId: jobData.proposalId,
      format: 'markdown',
      sentTo: jobData.clientEmail || 'client@example.com',
      content,
      deliveryMethod: 'email',
      deliveredAt: new Date(),
      confirmationSent: true
    };
  }

  async _evaluateForPortfolio(jobData) {
    // Evaluate if work should be included in portfolio
    const qualifies = jobData.qualityScore >= 4.5;

    return {
      qualifies,
      title: `Portfolio: ${jobData.clientName} Project`,
      niche: jobData.niche,
      description: 'Quality work suitable for case study',
      evaluatedAt: new Date()
    };
  }

  async _logOutcomes(jobData, portfolioResult) {
    // Log outcomes and lessons learned
    return {
      id: `strategy_${Date.now()}`,
      jobId: jobData.proposalId,
      clientName: jobData.clientName,
      keyInsights: [
        'Client satisfaction high',
        'Timeline met successfully',
        'Quality standards exceeded'
      ],
      lessonsLearned: [
        'Process refinement opportunities identified',
        'Client communication cadence effective'
      ],
      futureRecommendations: 'Schedule follow-up work',
      loggedAt: new Date()
    };
  }

  async _recordFinancials(jobData) {
    const revenue = jobData.proposal?.pricing?.total || 1500;
    const estimatedCost = revenue * 0.35; // 35% cost ratio

    return {
      id: `fin_${Date.now()}`,
      jobId: jobData.proposalId,
      clientName: jobData.clientName,
      revenue,
      cost: parseFloat(estimatedCost.toFixed(2)),
      profit: parseFloat((revenue - estimatedCost).toFixed(2)),
      profitMargin: parseFloat(((1 - estimatedCost / revenue) * 100).toFixed(1)),
      recordedAt: new Date()
    };
  }

  /**
   * Get approval queue status
   */
  getApprovalQueueStatus() {
    return {
      opportunities: {
        count: this.approvalQueues.opportunities.length,
        items: this.approvalQueues.opportunities.map(item => ({
          id: item.id,
          title: item.opportunity.title,
          score: item.opportunity.score,
          addedAt: item.addedToQueueAt
        }))
      },
      proposals: {
        count: this.approvalQueues.proposals.length,
        items: this.approvalQueues.proposals.map(item => ({
          id: item.id,
          clientName: item.proposal.clientName,
          addedAt: item.addedToQueueAt
        }))
      },
      content: {
        count: this.approvalQueues.content.length,
        items: this.approvalQueues.content.map(item => ({
          id: item.id,
          jobId: item.jobId,
          clientName: item.metadata.clientName,
          qualityScore: item.qualityScore,
          addedAt: item.addedToQueueAt
        }))
      }
    };
  }

  /**
   * Get pipeline metrics
   */
  getMetrics() {
    return {
      prospectStage: this.pipelineMetrics.prospectStage,
      pitchStage: this.pipelineMetrics.pitchStage,
      produceStage: this.pipelineMetrics.produceStage,
      deliverStage: this.pipelineMetrics.deliverStage,
      timestamp: new Date()
    };
  }

  /**
   * Get activity log
   */
  getActivityLog(limit = 100) {
    return this.activityLog.slice(-limit).reverse();
  }

  /**
   * Clear activity log
   */
  clearActivityLog() {
    this.activityLog = [];
  }

  /**
   * Log activity
   */
  _logActivity(action, details = {}) {
    const entry = {
      timestamp: new Date(),
      action,
      ...details
    };

    this.activityLog.push(entry);

    // Keep last 1000 entries in memory
    if (this.activityLog.length > 1000) {
      this.activityLog.shift();
    }
  }
}

module.exports = PipelineRunner;
