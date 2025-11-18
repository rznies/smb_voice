/**
 * Lead Capture Tool
 * Captures and syncs leads to CRM systems (HubSpot, Salesforce)
 */

import { llm } from '@livekit/agents';
import { z } from 'zod';
import { db } from '../lib/database.js';
import logger from '../lib/logger.js';

export interface LeadToolContext {
  businessId: string;
  callId: string;
  callerPhone?: string;
}

/**
 * Create a new lead/contact in the CRM
 */
export function createLeadCaptureTool(context: LeadToolContext) {
  return llm.tool({
    description: `Capture customer information and create a new lead in the CRM.

    Use this tool when:
    - A potential customer shows interest in products/services
    - You collect contact information for follow-up
    - The customer wants more information sent to them
    - The customer is not ready to book now but wants to be contacted later

    You should collect at least: name and email or phone number.`,

    parameters: z.object({
      name: z
        .string()
        .describe('Full name of the lead/customer'),
      email: z
        .string()
        .email()
        .optional()
        .describe('Email address of the lead'),
      phone: z
        .string()
        .optional()
        .describe('Phone number of the lead'),
      company: z
        .string()
        .optional()
        .describe('Company name (if applicable)'),
      interest_level: z
        .enum(['high', 'medium', 'low'])
        .optional()
        .default('medium')
        .describe('How interested the lead seems (high, medium, low)'),
      notes: z
        .string()
        .optional()
        .describe('Any additional notes about the lead, their interests, or requirements'),
    }),

    execute: async ({ name, email, phone, company, interest_level = 'medium', notes }) => {
      try {
        logger.info('Capturing lead', {
          businessId: context.businessId,
          callId: context.callId,
          name,
          email,
          phone,
        });

        // Validate we have at least email or phone
        if (!email && !phone && !context.callerPhone) {
          return 'I need either an email address or phone number to save your information. Could you provide one of those?';
        }

        // Get business details for CRM integration
        const business = await db.getBusiness(context.businessId);
        if (!business) {
          throw new Error('Business not found');
        }

        // Create lead in database
        const lead = await db.createLead({
          business_id: context.businessId,
          call_id: context.callId,
          name,
          email,
          phone: phone || context.callerPhone,
          company,
          source: 'voice_call',
          status: 'new',
          interest_level,
          notes,
        });

        logger.info('Lead created', { leadId: lead.id });

        // Sync to HubSpot if configured
        if (business.hubspot_api_key) {
          try {
            const hubspotContact = await createHubSpotContact({
              email: email || '',
              firstname: name.split(' ')[0],
              lastname: name.split(' ').slice(1).join(' ') || '',
              phone: phone || context.callerPhone || '',
              company,
              hs_lead_status: 'NEW',
              lead_source: 'AI Voice Agent',
              interest_level,
              notes,
            }, business.hubspot_api_key);

            // Update lead with HubSpot ID
            await db.updateLead(lead.id, {
              hubspot_contact_id: hubspotContact.id,
              synced_at: new Date().toISOString(),
            });

            logger.info('Lead synced to HubSpot', {
              leadId: lead.id,
              hubspotId: hubspotContact.id,
            });
          } catch (hubspotError) {
            logger.error('Failed to sync lead to HubSpot', { error: hubspotError });
            // Continue anyway - lead is still saved in our database
          }
        }

        // Log the event
        await db.logCallEvent(context.callId, 'lead_captured', {
          lead_id: lead.id,
          name,
          email,
          phone,
        });

        // Update call outcome
        await db.updateCall(context.callId, {
          outcome: 'lead_captured',
          caller_name: name,
          caller_email: email,
        });

        // Return success message
        return `Great! I've saved your information, ${name}. ${email ? `We'll send you more details at ${email}.` : `We'll follow up with you at ${phone || 'the number you called from'}.`} Is there anything else I can help you with today?`;

      } catch (error) {
        logger.error('Failed to capture lead', { error, context });
        return 'I apologize, but I had trouble saving your information. Let me make sure our team gets your details - could you repeat your contact information?';
      }
    },
  });
}

/**
 * Create a contact in HubSpot
 */
async function createHubSpotContact(
  contactData: Record<string, any>,
  apiKey: string
): Promise<{ id: string }> {
  const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: contactData,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HubSpot API error: ${error}`);
  }

  const data = await response.json();
  return { id: data.id };
}

/**
 * Lookup existing customer by phone number
 */
export function createLookupCustomerTool(context: LeadToolContext) {
  return llm.tool({
    description: `Look up an existing customer by their phone number.

    Use this tool when:
    - You want to check if the caller is an existing customer
    - You need to retrieve customer history or information
    - The caller mentions they've contacted before

    This helps personalize the conversation.`,

    parameters: z.object({
      phone: z
        .string()
        .optional()
        .describe('Phone number to look up (if not provided, uses the current caller\'s number)'),
    }),

    execute: async ({ phone }) => {
      try {
        const lookupPhone = phone || context.callerPhone;

        if (!lookupPhone) {
          return 'I don\'t have a phone number to look up. Could you provide the phone number you\'d like me to check?';
        }

        logger.info('Looking up customer', {
          businessId: context.businessId,
          phone: lookupPhone,
        });

        // Search for existing leads with this phone number
        const { data: leads, error } = await db.client
          .from('leads')
          .select('*')
          .eq('business_id', context.businessId)
          .eq('phone', lookupPhone)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) {
          logger.error('Error looking up customer', { error });
          return 'I was unable to look up that information right now.';
        }

        if (!leads || leads.length === 0) {
          return 'I don\'t see any previous records for this phone number. It looks like you\'re a new customer - welcome! How can I help you today?';
        }

        const lead = leads[0];
        const lastContactDate = new Date(lead.created_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        let message = `Welcome back${lead.name ? `, ${lead.name.split(' ')[0]}` : ''}! `;
        message += `I see we last spoke on ${lastContactDate}. `;

        if (lead.status === 'converted') {
          message += 'Thank you for being a valued customer. ';
        }

        message += 'How can I assist you today?';

        // Log the lookup
        await db.logCallEvent(context.callId, 'customer_looked_up', {
          lead_id: lead.id,
          customer_name: lead.name,
          last_contact: lead.created_at,
        });

        return message;

      } catch (error) {
        logger.error('Failed to lookup customer', { error, context });
        return 'How can I help you today?';
      }
    },
  });
}
