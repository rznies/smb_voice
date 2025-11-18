/**
 * Transfer to Human Tool
 * Allows the agent to transfer calls to a human operator
 */

import { llm } from '@livekit/agents';
import { z } from 'zod';
import { db } from '../lib/database.js';
import logger from '../lib/logger.js';

export interface TransferToolContext {
  businessId: string;
  callId: string;
  twilioCallSid?: string;
}

/**
 * Transfer call to a human operator
 */
export function createTransferToHumanTool(context: TransferToolContext) {
  return llm.tool({
    description: `Transfer the call to a human team member.

    Use this tool when:
    - The customer specifically requests to speak to a human
    - The query is too complex for you to handle
    - The customer is frustrated or upset
    - You need authorization or approval beyond your capabilities
    - Technical issues or account-specific problems arise

    Always be professional and set expectations for the transfer.`,

    parameters: z.object({
      reason: z
        .string()
        .describe('The reason for the transfer (e.g., "complex billing question", "technical support", "customer request")'),
      urgency: z
        .enum(['low', 'medium', 'high'])
        .optional()
        .default('medium')
        .describe('How urgent is this transfer? (low, medium, high)'),
      notes: z
        .string()
        .optional()
        .describe('Any context or notes to pass to the human agent'),
    }),

    execute: async ({ reason, urgency = 'medium', notes }) => {
      try {
        logger.info('Initiating transfer to human', {
          businessId: context.businessId,
          callId: context.callId,
          reason,
          urgency,
        });

        // Get business details to find the transfer number
        const business = await db.getBusiness(context.businessId);
        if (!business) {
          throw new Error('Business not found');
        }

        // Get phone number configuration
        const call = await db.getCall(context.callId);
        if (!call || !call.phone_number_id) {
          throw new Error('Call or phone number not found');
        }

        const { data: phoneNumber } = await db.client
          .from('phone_numbers')
          .select('*')
          .eq('id', call.phone_number_id)
          .single();

        const transferNumber = phoneNumber?.forward_to;

        if (!transferNumber) {
          logger.error('No transfer number configured', { businessId: context.businessId });
          return 'I apologize, but I\'m unable to complete the transfer at this moment. However, I\'ll make sure our team reaches out to you shortly. Can I get the best number to reach you?';
        }

        // Update the call record
        await db.updateCall(context.callId, {
          transferred_to_human: true,
          outcome: 'transferred',
          notes: `Transfer reason: ${reason}. ${notes || ''}`.trim(),
        });

        // Log the transfer event
        await db.logCallEvent(context.callId, 'transfer_initiated', {
          reason,
          urgency,
          notes,
          transfer_number: transferNumber,
        });

        // If we have Twilio call SID, we can actually transfer the call
        if (context.twilioCallSid) {
          try {
            await initiateTransferViaTwilio(context.twilioCallSid, transferNumber, {
              callId: context.callId,
              reason,
              urgency,
              notes,
            });

            logger.info('Twilio transfer initiated', {
              callId: context.callId,
              twilioSid: context.twilioCallSid,
            });

            return `Certainly! I'm transferring you now to one of our team members who can help with ${reason}. Please hold for just a moment.`;

          } catch (transferError) {
            logger.error('Failed to transfer via Twilio', { error: transferError });
            // Fall through to manual transfer
          }
        }

        // Fallback: Provide manual transfer information
        return `I understand you need help with ${reason}. I'm going to connect you with our team right away. Please hold on while I transfer your call.`;

      } catch (error) {
        logger.error('Failed to transfer to human', { error, context });
        return 'I apologize for the difficulty. Let me make sure someone from our team contacts you directly. Could you confirm the best number to reach you?';
      }
    },
  });
}

/**
 * Initiate a transfer via Twilio API
 */
async function initiateTransferViaTwilio(
  callSid: string,
  transferNumber: string,
  metadata: Record<string, any>
): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    },
    body: new URLSearchParams({
      Twiml: `<Response>
        <Say>Please hold while I transfer you to a team member.</Say>
        <Dial>
          <Number>${transferNumber}</Number>
        </Dial>
      </Response>`,
      StatusCallback: `${process.env.TWILIO_WEBHOOK_URL}/status`,
      StatusCallbackEvent: 'initiated,ringing,answered,completed',
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Twilio transfer failed: ${error}`);
  }
}

/**
 * Get business hours tool - helps determine if the business is open
 */
export function createBusinessHoursTool(context: TransferToolContext) {
  return llm.tool({
    description: `Check if the business is currently open based on business hours.

    Use this tool to determine if you should offer to transfer to a human or if you should
    take a message for callback during business hours.`,

    parameters: z.object({}),

    execute: async () => {
      try {
        const business = await db.getBusiness(context.businessId);
        if (!business || !business.business_hours) {
          return 'Our team is available Monday through Friday, 9 AM to 5 PM local time.';
        }

        const now = new Date();
        const timezone = business.timezone || 'America/New_York';

        // Get current day and time in business timezone
        const currentDay = now.toLocaleDateString('en-US', {
          weekday: 'lowercase',
          timeZone: timezone,
        });
        const currentTime = now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timezone,
        });

        const hours = business.business_hours as Record<string, { open: string; close: string }>;
        const todayHours = hours[currentDay];

        if (!todayHours) {
          return 'Our office is closed today. We\'ll be happy to help you during our regular business hours. Would you like to leave a message or schedule a callback?';
        }

        const { open, close } = todayHours;
        const isOpen = currentTime >= open && currentTime < close;

        if (isOpen) {
          return `Our office is currently open until ${formatTime(close)}. I can transfer you to a team member if needed.`;
        } else {
          return `Our office is currently closed. We're open ${formatTime(open)} to ${formatTime(close)} ${currentDay}. Would you like to schedule a callback or leave a message?`;
        }

      } catch (error) {
        logger.error('Failed to check business hours', { error, context });
        return 'I can help you schedule a callback with our team. What time works best for you?';
      }
    },
  });
}

/**
 * Format time string for natural speech
 */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}
