/**
 * Appointment Booking Tool
 * Allows the agent to book appointments via Google Calendar
 */

import { llm } from '@livekit/agents';
import { z } from 'zod';
import { google } from 'googleapis';
import { db } from '../lib/database.js';
import logger from '../lib/logger.js';

export interface AppointmentToolContext {
  businessId: string;
  callId: string;
  callerName?: string;
  callerEmail?: string;
  callerPhone?: string;
}

/**
 * Book an appointment tool
 * Uses Google Calendar API to create calendar events
 */
export function createBookAppointmentTool(context: AppointmentToolContext) {
  return llm.tool({
    description: `Book an appointment for the customer.

    Use this tool when the customer wants to schedule a meeting, consultation, or appointment.
    You MUST collect: date, time, customer name, and email before calling this tool.

    If any required information is missing, ask the customer for it before using this tool.`,

    parameters: z.object({
      date: z
        .string()
        .describe('The date of the appointment in YYYY-MM-DD format (e.g., 2025-11-20)'),
      time: z
        .string()
        .describe('The time of the appointment in HH:MM format, 24-hour time (e.g., 14:30 for 2:30 PM)'),
      customer_name: z
        .string()
        .describe('The full name of the customer'),
      customer_email: z
        .string()
        .email()
        .describe('The email address of the customer'),
      customer_phone: z
        .string()
        .optional()
        .describe('The phone number of the customer (optional)'),
      purpose: z
        .string()
        .optional()
        .describe('The purpose or description of the appointment (optional)'),
      duration_minutes: z
        .number()
        .optional()
        .default(30)
        .describe('Duration of the appointment in minutes (default: 30)'),
    }),

    execute: async ({ date, time, customer_name, customer_email, customer_phone, purpose, duration_minutes = 30 }) => {
      try {
        logger.info('Booking appointment', {
          businessId: context.businessId,
          callId: context.callId,
          date,
          time,
          customer_name,
          customer_email,
        });

        // Combine date and time into ISO format
        const scheduledAt = new Date(`${date}T${time}:00`);

        // Validate the date is in the future
        if (scheduledAt < new Date()) {
          return 'I apologize, but that date and time has already passed. Could you provide a future date and time for your appointment?';
        }

        // Get business details for calendar integration
        const business = await db.getBusiness(context.businessId);
        if (!business) {
          throw new Error('Business not found');
        }

        let googleMeetLink: string | undefined;
        let calendarEventId: string | undefined;

        // Create Google Calendar event if connected
        if (business.google_calendar_connected && business.google_calendar_id) {
          try {
            const auth = new google.auth.GoogleAuth({
              credentials: {
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
              },
              scopes: ['https://www.googleapis.com/auth/calendar'],
            });

            const calendar = google.calendar({ version: 'v3', auth });

            const event = {
              summary: purpose || `Meeting with ${customer_name}`,
              description: `
                Appointment booked via AI Voice Agent

                Customer: ${customer_name}
                Email: ${customer_email}
                ${customer_phone ? `Phone: ${customer_phone}` : ''}
                ${purpose ? `Purpose: ${purpose}` : ''}
              `.trim(),
              start: {
                dateTime: scheduledAt.toISOString(),
                timeZone: business.timezone || 'America/New_York',
              },
              end: {
                dateTime: new Date(scheduledAt.getTime() + duration_minutes * 60000).toISOString(),
                timeZone: business.timezone || 'America/New_York',
              },
              attendees: [
                { email: customer_email, displayName: customer_name },
              ],
              conferenceData: {
                createRequest: {
                  requestId: `${context.callId}-${Date.now()}`,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            };

            const response = await calendar.events.insert({
              calendarId: business.google_calendar_id,
              requestBody: event,
              conferenceDataVersion: 1,
              sendUpdates: 'all',
            });

            calendarEventId = response.data.id || undefined;
            googleMeetLink = response.data.hangoutLink || undefined;

            logger.info('Google Calendar event created', {
              eventId: calendarEventId,
              meetLink: googleMeetLink,
            });
          } catch (calendarError) {
            logger.error('Failed to create Google Calendar event', { error: calendarError });
            // Continue anyway - we'll save the appointment in our database
          }
        }

        // Save appointment to database
        const appointment = await db.createAppointment({
          business_id: context.businessId,
          call_id: context.callId,
          title: purpose || `Meeting with ${customer_name}`,
          description: purpose,
          scheduled_at: scheduledAt.toISOString(),
          duration_minutes,
          attendee_name: customer_name,
          attendee_email: customer_email,
          attendee_phone: customer_phone || context.callerPhone,
          google_calendar_event_id: calendarEventId,
          google_meet_link: googleMeetLink,
          status: 'scheduled',
        });

        // Log the event
        await db.logCallEvent(context.callId, 'appointment_booked', {
          appointment_id: appointment.id,
          scheduled_at: scheduledAt.toISOString(),
          customer_name,
          customer_email,
        });

        // Update call outcome
        await db.updateCall(context.callId, {
          outcome: 'appointment_booked',
        });

        // Return success message
        const formattedDate = scheduledAt.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        const formattedTime = scheduledAt.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        let confirmationMessage = `Perfect! I've successfully booked your appointment for ${formattedDate} at ${formattedTime}.`;

        if (googleMeetLink) {
          confirmationMessage += ` A calendar invitation with a Google Meet link has been sent to ${customer_email}.`;
        } else {
          confirmationMessage += ` You'll receive a confirmation email at ${customer_email} shortly.`;
        }

        return confirmationMessage;

      } catch (error) {
        logger.error('Failed to book appointment', { error, context });
        return 'I apologize, but I encountered an issue while booking your appointment. Let me transfer you to our team who can help you schedule this manually.';
      }
    },
  });
}
