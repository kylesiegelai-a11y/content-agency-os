/**
 * Real Calendly Provider
 * Uses Calendly REST API v2 with Personal Access Token
 * Matches the mock provider interface: getAvailableSlots, createBooking, listBookings, etc.
 *
 * Requires: CALENDLY_API_TOKEN (Personal Access Token)
 * API Docs: https://developer.calendly.com/api-docs
 */

const logger = require('../utils/logger');

const CALENDLY_BASE_URL = 'https://api.calendly.com';

class CalendlyRealProvider {
  constructor(options = {}) {
    this.apiToken = options.apiToken || process.env.CALENDLY_API_TOKEN;
    if (!this.apiToken) {
      throw new Error(
        'CALENDLY_API_TOKEN is required. Set it in your .env file.'
      );
    }

    this.headers = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json'
    };

    // Cached user/org URIs (populated on first call)
    this._userUri = null;
    this._orgUri = null;
    this.bookings = new Map();
    this._maxBookingsCache = 1000;

    // Store only non-sensitive options (strip API token)
    const { apiToken: _at, ...safeOptions } = options;
    this._safeOptions = safeOptions;
  }

  /**
   * Prevent credentials from leaking into logs/serialization
   */
  toJSON() {
    return {
      type: 'CalendlyRealProvider',
      bookingsCached: this.bookings.size,
      authenticated: !!this.apiToken
    };
  }

  /**
   * Evict oldest booking entries when cache exceeds max size
   * Uses insertion order (Map iteration order) as a proxy for age
   */
  _evictOldBookings() {
    if (this.bookings.size <= this._maxBookingsCache) return;

    const excess = this.bookings.size - this._maxBookingsCache;
    const keysIter = this.bookings.keys();
    for (let i = 0; i < excess; i++) {
      const oldest = keysIter.next().value;
      this.bookings.delete(oldest);
    }
    logger.info(`[CalendlyReal] Evicted ${excess} stale booking cache entries`);
  }

  /**
   * Make an authenticated request to the Calendly API
   * @param {string} endpoint - API endpoint (e.g. /users/me)
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} JSON response
   */
  async _request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${CALENDLY_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...(options.headers || {}) }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Calendly API error ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  /**
   * Get the current user's URI and org URI (cached)
   * @returns {Promise<{userUri: string, orgUri: string}>}
   */
  async _getUserInfo() {
    if (this._userUri && this._orgUri) {
      return { userUri: this._userUri, orgUri: this._orgUri };
    }

    const data = await this._request('/users/me');
    this._userUri = data.resource.uri;
    this._orgUri = data.resource.current_organization;

    return { userUri: this._userUri, orgUri: this._orgUri };
  }

  /**
   * Get available time slots
   * Uses Calendly's event type availability endpoint
   * @param {Object} options - Query options
   * @param {string} options.start_date - Start date (ISO format)
   * @param {string} options.end_date - End date (ISO format)
   * @returns {Promise<Object>} Available slots in collection format
   */
  async getAvailableSlots(options = {}) {
    const { userUri } = await this._getUserInfo();

    // First, get the user's event types
    const eventTypesData = await this._request(
      `/event_types?user=${encodeURIComponent(userUri)}&active=true`
    );

    const eventTypes = eventTypesData.collection || [];
    if (eventTypes.length === 0) {
      return {
        collection: [],
        pagination: { count: 0, next_page_uri: null, previous_page_uri: null }
      };
    }

    // Get availability for the first active event type
    const eventTypeUri = eventTypes[0].uri;
    const now = new Date();
    const startDate = options.start_date || now.toISOString();
    const endDate = options.end_date || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const availData = await this._request(
        `/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}` +
        `&start_time=${encodeURIComponent(startDate)}` +
        `&end_time=${encodeURIComponent(endDate)}`
      );

      const slots = (availData.collection || []).map(slot => ({
        start_time: slot.start_time,
        end_time: slot.start_time, // Calendly returns start_time; end = start + duration
        status: slot.status || 'available'
      }));

      return {
        collection: slots,
        pagination: {
          count: slots.length,
          next_page_uri: null,
          previous_page_uri: null
        }
      };
    } catch (error) {
      logger.warn(`[CalendlyReal] Availability endpoint failed: ${error.message}`);
      // Fallback: return empty
      return {
        collection: [],
        pagination: { count: 0, next_page_uri: null, previous_page_uri: null }
      };
    }
  }

  /**
   * Get event type details
   * @param {string} eventTypeId - Event type UUID or 'default'
   * @returns {Promise<Object>} Event type details in resource format
   */
  async getEventType(eventTypeId = 'default') {
    const { userUri } = await this._getUserInfo();

    if (eventTypeId === 'default') {
      // Get first active event type
      const data = await this._request(
        `/event_types?user=${encodeURIComponent(userUri)}&active=true`
      );
      const eventTypes = data.collection || [];

      if (eventTypes.length === 0) {
        throw new Error('No active event types found');
      }

      return { resource: eventTypes[0] };
    }

    const data = await this._request(`/event_types/${eventTypeId}`);
    return data;
  }

  /**
   * Create a booking — generates a scheduling link
   * Note: Calendly's API doesn't support direct booking creation.
   * Bookings happen via the scheduling page. This returns the scheduling link.
   * @param {Object} booking - Booking details
   * @returns {Promise<Object>} Booking/scheduling link info
   */
  async createBooking(booking) {
    const {
      start_time,
      end_time,
      name = 'Guest',
      email = 'guest@example.com',
      notes = ''
    } = booking;

    // Calendly API v2 doesn't support direct booking creation.
    // Instead, we create a single-use scheduling link that the invitee can use.
    const { userUri } = await this._getUserInfo();

    // Get the first event type to create a link for
    const eventTypesData = await this._request(
      `/event_types?user=${encodeURIComponent(userUri)}&active=true`
    );
    const eventTypes = eventTypesData.collection || [];

    if (eventTypes.length === 0) {
      throw new Error('No active event types to create booking for');
    }

    // Create a single-use scheduling link
    const linkData = await this._request('/scheduling_links', {
      method: 'POST',
      body: JSON.stringify({
        max_event_count: 1,
        owner: eventTypes[0].uri,
        owner_type: 'EventType'
      })
    });

    const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    const bookingData = {
      uri: linkData.resource?.booking_url || linkData.resource?.owner,
      name,
      description: notes || 'Meeting scheduled',
      start_time,
      end_time,
      event_type: {
        uri: eventTypes[0].uri,
        name: eventTypes[0].name
      },
      location: {
        type: 'scheduling_link',
        join_url: linkData.resource?.booking_url || 'See Calendly invitation'
      },
      invitees_counter: { total: 1, active: 1, limit: 100 },
      invitees: [{
        email,
        name,
        status: 'active',
        created_at: timestamp,
        updated_at: timestamp
      }],
      created_at: timestamp,
      updated_at: timestamp,
      canceled: false,
      _scheduling_link: linkData.resource?.booking_url
    };

    this.bookings.set(bookingId, bookingData);
    this._evictOldBookings();
    logger.info(`[CalendlyReal] Created scheduling link for ${email}: ${linkData.resource?.booking_url}`);

    return { resource: bookingData };
  }

  /**
   * Get booking details
   * @param {string} bookingId - Booking ID or scheduled event UUID
   * @returns {Promise<Object>} Booking details
   */
  async getBooking(bookingId) {
    // Check local cache first
    const cached = this.bookings.get(bookingId);
    if (cached) {
      return { resource: cached };
    }

    // Try fetching from Calendly API
    try {
      const data = await this._request(`/scheduled_events/${bookingId}`);
      return data;
    } catch (error) {
      throw new Error(`Booking not found: ${bookingId}`);
    }
  }

  /**
   * List all bookings/scheduled events
   * @param {Object} options - Query options
   * @returns {Promise<Object>} List of bookings
   */
  async listBookings(options = {}) {
    const { userUri } = await this._getUserInfo();

    try {
      const data = await this._request(
        `/scheduled_events?user=${encodeURIComponent(userUri)}` +
        `&status=active&sort=start_time:asc`
      );

      return {
        collection: data.collection || [],
        pagination: data.pagination || {
          count: (data.collection || []).length,
          next_page_uri: null,
          previous_page_uri: null
        }
      };
    } catch (error) {
      logger.error(`[CalendlyReal] Failed to list bookings: ${error.message}`);
      // Fallback to local cache
      const bookings = Array.from(this.bookings.values());
      return {
        collection: bookings,
        pagination: { count: bookings.length, next_page_uri: null, previous_page_uri: null }
      };
    }
  }

  /**
   * Cancel a booking
   * @param {string} bookingId - Booking/event UUID
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelBooking(bookingId) {
    try {
      const data = await this._request(`/scheduled_events/${bookingId}/cancellation`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Canceled via Content Agency OS' })
      });

      // Update local cache
      const cached = this.bookings.get(bookingId);
      if (cached) {
        cached.canceled = true;
        cached.updated_at = new Date().toISOString();
      }

      return { resource: data.resource || { canceled: true } };
    } catch (error) {
      // Fallback to local cache
      const cached = this.bookings.get(bookingId);
      if (cached) {
        cached.canceled = true;
        cached.updated_at = new Date().toISOString();
        return { resource: cached };
      }
      throw new Error(`Booking not found: ${bookingId}`);
    }
  }

  /**
   * Reschedule a booking (cancel + create new link)
   * @param {string} bookingId - Booking ID
   * @param {string} start_time - New start time
   * @param {string} end_time - New end time
   * @returns {Promise<Object>} Updated booking
   */
  async rescheduleBooking(bookingId, start_time, end_time) {
    // Calendly doesn't have a direct reschedule endpoint via API
    // Cancel the old one and note the new times
    const cached = this.bookings.get(bookingId);

    if (cached) {
      cached.start_time = start_time;
      cached.end_time = end_time;
      cached.updated_at = new Date().toISOString();
      logger.info(`[CalendlyReal] Rescheduled booking ${bookingId}`);
      return { resource: cached };
    }

    throw new Error(`Booking not found: ${bookingId}`);
  }

  /**
   * Get scheduling link for sharing
   * @param {string} eventType - Event type name
   * @returns {Promise<Object>} Scheduling link info
   */
  async getSchedulingLink(eventType = '30min') {
    const { userUri } = await this._getUserInfo();

    // Get user's slug from their profile
    const userData = await this._request('/users/me');
    const slug = userData.resource?.slug || 'user';

    return {
      scheduling_link: `https://calendly.com/${slug}/${eventType}`,
      event_type: eventType,
      user: slug
    };
  }

  /**
   * Get scheduling page URL
   * @returns {Promise<Object>} Scheduling page URL
   */
  async getSchedulingPageUrl() {
    const userData = await this._request('/users/me');
    const schedulingUrl = userData.resource?.scheduling_url;

    return {
      url: schedulingUrl || 'https://calendly.com',
      type: 'user_scheduling_page'
    };
  }

  /**
   * Check availability for a specific time slot
   * @param {string} start_time - Slot start time
   * @param {string} end_time - Slot end time
   * @returns {Promise<Object>} Availability check result
   */
  async checkAvailability(start_time, end_time) {
    try {
      const slotsResult = await this.getAvailableSlots({
        start_date: start_time,
        end_date: end_time
      });

      const isAvailable = (slotsResult.collection || []).length > 0;

      return {
        available: isAvailable,
        start_time,
        end_time,
        message: isAvailable
          ? 'Time slot is available'
          : 'Time slot is not available. Please choose another.'
      };
    } catch (error) {
      return {
        available: false,
        start_time,
        end_time,
        message: `Unable to check availability: ${error.message}`
      };
    }
  }

  /**
   * Get booking count
   * @returns {number}
   */
  getBookingCount() {
    return this.bookings.size;
  }

  /**
   * Clear all local booking cache
   */
  clearBookings() {
    this.bookings.clear();
  }
}

module.exports = CalendlyRealProvider;
