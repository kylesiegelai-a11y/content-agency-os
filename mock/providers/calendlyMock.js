/**
 * Mock Calendly Provider
 * Returns 3 available time slots for next 7 days in Calendly API format
 * Returns static mock booking URL
 * Simulates full scheduling flow
 */

/**
 * Generate available time slots for next 7 days
 * Returns 3 slots per day with 1-hour duration
 * @returns {Array} Array of available time slots
 */
function generateAvailableSlots() {
  const slots = [];
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  // Generate 3 slots per day for next 7 days
  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    const dayStart = new Date(startOfDay);
    dayStart.setDate(dayStart.getDate() + dayOffset);

    // Generate 3 time slots per day (9am, 1pm, 3pm)
    const hours = [9, 13, 15];

    hours.forEach(hour => {
      const slotStart = new Date(dayStart);
      slotStart.setHours(hour, 0, 0, 0);

      const slotEnd = new Date(slotStart);
      slotEnd.setHours(hour + 1, 0, 0, 0);

      // Only add if in the future
      if (slotEnd > now) {
        slots.push({
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
          status: 'available'
        });
      }
    });
  }

  return slots;
}

/**
 * Generate unique booking ID
 * @returns {string} Booking ID
 */
function generateBookingId() {
  return `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Mock Calendly API provider
 */
class CalendlyMock {
  constructor(options = {}) {
    this.options = options;
    this.bookings = new Map();
    this.eventTypeUri = 'https://calendly.com/mock-user/30min';
  }

  /**
   * Get available time slots for calendar
   * Returns 3 slots per day for next 7 days
   * @param {Object} options - Query options
   * @param {string} options.start_date - Start date for slot generation (ISO format)
   * @param {string} options.end_date - End date for slot generation (ISO format)
   * @returns {Promise<Object>} Calendly API response with available slots
   */
  async getAvailableSlots(options = {}) {
    const slots = generateAvailableSlots();

    return {
      collection: slots,
      pagination: {
        count: slots.length,
        next_page_uri: null,
        previous_page_uri: null
      }
    };
  }

  /**
   * Get event type details
   * @param {string} eventTypeId - Event type ID or name
   * @returns {Promise<Object>} Event type details
   */
  async getEventType(eventTypeId = 'default') {
    return {
      resource: {
        uri: this.eventTypeUri,
        name: '30 Minute Meeting',
        description: 'Schedule a quick 30-minute meeting to discuss your project needs.',
        duration_minutes: 30,
        owner: {
          uri: 'https://calendly.com/v1/users/USERID',
          name: 'Mock User'
        },
        updated_at: new Date().toISOString()
      }
    };
  }

  /**
   * Create a booking (schedule a meeting)
   * @param {Object} booking - Booking details
   * @param {string} booking.start_time - Start time (ISO format)
   * @param {string} booking.end_time - End time (ISO format)
   * @param {string} booking.name - Guest name
   * @param {string} booking.email - Guest email
   * @param {string} booking.notes - Meeting notes/agenda
   * @returns {Promise<Object>} Booking confirmation
   */
  async createBooking(booking) {
    const {
      start_time,
      end_time,
      name = 'Guest',
      email = 'guest@example.com',
      notes = ''
    } = booking;

    const bookingId = generateBookingId();
    const timestamp = new Date().toISOString();

    const bookingData = {
      uri: `https://calendly.com/v1/scheduled_events/${bookingId}`,
      name: name,
      description: notes || 'Meeting scheduled',
      start_time: start_time,
      end_time: end_time,
      event_type: {
        uri: this.eventTypeUri,
        name: '30 Minute Meeting'
      },
      location: {
        type: 'video call',
        join_url: `https://zoom.us/j/mock${Math.random().toString(36).substr(2, 9).toUpperCase()}`
      },
      invitees_counter: {
        total: 1,
        active: 1,
        limit: 100
      },
      invitees: [
        {
          email: email,
          name: name,
          status: 'active',
          created_at: timestamp,
          updated_at: timestamp
        }
      ],
      created_at: timestamp,
      updated_at: timestamp,
      canceled: false
    };

    this.bookings.set(bookingId, bookingData);

    return {
      resource: bookingData
    };
  }

  /**
   * Get booking details
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Object>} Booking details
   */
  async getBooking(bookingId) {
    const booking = this.bookings.get(bookingId);

    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`);
    }

    return {
      resource: booking
    };
  }

  /**
   * List all bookings
   * @param {Object} options - Query options
   * @returns {Promise<Object>} List of bookings
   */
  async listBookings(options = {}) {
    const bookings = Array.from(this.bookings.values());

    return {
      collection: bookings,
      pagination: {
        count: bookings.length,
        next_page_uri: null,
        previous_page_uri: null
      }
    };
  }

  /**
   * Cancel a booking
   * @param {string} bookingId - Booking ID to cancel
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelBooking(bookingId) {
    const booking = this.bookings.get(bookingId);

    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`);
    }

    booking.canceled = true;
    booking.updated_at = new Date().toISOString();

    return {
      resource: booking
    };
  }

  /**
   * Reschedule a booking
   * @param {string} bookingId - Booking ID to reschedule
   * @param {string} start_time - New start time (ISO format)
   * @param {string} end_time - New end time (ISO format)
   * @returns {Promise<Object>} Updated booking
   */
  async rescheduleBooking(bookingId, start_time, end_time) {
    const booking = this.bookings.get(bookingId);

    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`);
    }

    booking.start_time = start_time;
    booking.end_time = end_time;
    booking.updated_at = new Date().toISOString();

    return {
      resource: booking
    };
  }

  /**
   * Get scheduling link for sharing
   * Returns mock Calendly booking URL
   * @param {string} eventType - Event type name
   * @returns {Promise<Object>} Scheduling link
   */
  async getSchedulingLink(eventType = '30min') {
    const mockUsername = 'mock-user';
    const mockEventType = eventType.replace(/\s+/g, '-').toLowerCase();

    return {
      scheduling_link: `https://calendly.com/${mockUsername}/${mockEventType}`,
      event_type: eventType,
      user: mockUsername
    };
  }

  /**
   * Get scheduling page URL
   * @returns {Promise<Object>} Scheduling page URL
   */
  async getSchedulingPageUrl() {
    return {
      url: 'https://calendly.com/mock-user',
      type: 'user_scheduling_page'
    };
  }

  /**
   * Check availability for specific time slot
   * @param {string} start_time - Slot start time (ISO format)
   * @param {string} end_time - Slot end time (ISO format)
   * @returns {Promise<Object>} Availability check result
   */
  async checkAvailability(start_time, end_time) {
    const slots = generateAvailableSlots();
    const requestedStart = new Date(start_time);
    const requestedEnd = new Date(end_time);

    const isAvailable = slots.some(slot => {
      const slotStart = new Date(slot.start_time);
      const slotEnd = new Date(slot.end_time);

      return (
        requestedStart >= slotStart &&
        requestedEnd <= slotEnd &&
        slot.status === 'available'
      );
    });

    return {
      available: isAvailable,
      start_time,
      end_time,
      message: isAvailable
        ? 'Time slot is available'
        : 'Time slot is not available. Please choose another.'
    };
  }

  /**
   * Get booking count
   * @returns {number} Total bookings
   */
  getBookingCount() {
    return this.bookings.size;
  }

  /**
   * Clear all bookings
   */
  clearBookings() {
    this.bookings.clear();
  }

  /**
   * Get mock booking URL for testing
   * @returns {string} Mock booking URL
   */
  getMockBookingUrl() {
    return `https://calendly.com/mock-user/30min?utm_source=mock_provider&utm_medium=api&utm_campaign=content_agency_os`;
  }

  /**
   * Simulate webhook event (for testing webhook integration)
   * @param {string} eventType - Event type (invitee.created, invitee.canceled)
   * @param {Object} eventData - Event data
   * @returns {Object} Webhook payload
   */
  simulateWebhookEvent(eventType, eventData = {}) {
    return {
      event: eventType,
      created_at: new Date().toISOString(),
      data: eventData
    };
  }
}

module.exports = CalendlyMock;
