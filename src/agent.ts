/**
 * SMB Voice AI Agent
 * Production-ready voice agent with Deepgram STT, Gemini LLM, and ElevenLabs TTS
 */

import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
  metrics,
} from '@livekit/agents';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as silero from '@livekit/agents-plugin-silero';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { DeepgramSTT } from './models/deepgram-stt.js';
import { GeminiLLM } from './models/gemini-llm.js';
import { ElevenLabsTTS } from './models/elevenlabs-tts.js';
import {
  createBookAppointmentTool,
  type AppointmentToolContext,
} from './tools/appointment.js';
import {
  createLeadCaptureTool,
  createLookupCustomerTool,
  type LeadToolContext,
} from './tools/lead.js';
import {
  createTransferToHumanTool,
  createBusinessHoursTool,
  type TransferToolContext,
} from './tools/transfer.js';
import { db } from './lib/database.js';
import logger from './lib/logger.js';

dotenv.config({ path: '.env.local' });

/**
 * SMB Voice Assistant Agent
 * Handles inbound/outbound calls with natural conversation and function calling
 */
class SMBVoiceAssistant extends voice.Agent {
  private businessId: string;
  private callId: string;
  private context: AppointmentToolContext & LeadToolContext & TransferToolContext;

  constructor(businessId: string, callId: string, callerPhone?: string, twilioCallSid?: string) {
    // Build context for tools
    const context: AppointmentToolContext & LeadToolContext & TransferToolContext = {
      businessId,
      callId,
      callerPhone,
      twilioCallSid,
    };

    // Get system prompt from business settings or use default
    const systemPrompt = process.env.SYSTEM_PROMPT || `You are a professional, warm SMB receptionist for a business.

Your responsibilities:
- Greet callers warmly and professionally
- Answer questions about the business, products, and services
- Book appointments using the book_appointment tool
- Capture leads using the create_lead tool
- Transfer complex queries to a human using the transfer_to_human tool
- Look up existing customers using the lookup_customer tool

Communication style:
- Speak naturally and conversationally, like a human receptionist
- Keep responses under 20 seconds when possible
- Be warm, friendly, and professional
- Show empathy and understanding
- Ask clarifying questions when needed
- Never use asterisks, emojis, or special formatting in your speech

Important guidelines:
- Always collect complete information before using tools (name, email, date/time for appointments)
- Confirm important details with the caller
- If you can't help, offer to transfer to a team member
- Thank callers and offer additional help before ending the call`;

    super({
      instructions: systemPrompt,
      tools: {
        // Appointment booking
        book_appointment: createBookAppointmentTool(context),

        // Lead capture & lookup
        create_lead: createLeadCaptureTool(context),
        lookup_customer: createLookupCustomerTool(context),

        // Transfer & business hours
        transfer_to_human: createTransferToHumanTool(context),
        check_business_hours: createBusinessHoursTool(context),
      },
    });

    this.businessId = businessId;
    this.callId = callId;
    this.context = context;

    logger.info('SMB Voice Assistant initialized', {
      businessId,
      callId,
      callerPhone,
      twilioCallSid,
    });
  }
}

/**
 * Agent definition for LiveKit
 */
export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    // Preload VAD model for turn detection
    proc.userData.vad = await silero.VAD.load();
    logger.info('Agent prewarmed - VAD model loaded');
  },

  entry: async (ctx: JobContext) => {
    try {
      logger.info('Agent entry - new job started', {
        roomName: ctx.room.name,
        roomSid: ctx.room.sid,
      });

      // Extract business and call context from room metadata
      const roomMetadata = JSON.parse(ctx.room.metadata || '{}');
      const businessId = roomMetadata.businessId;
      const callId = roomMetadata.callId;
      const callerPhone = roomMetadata.callerPhone;
      const twilioCallSid = roomMetadata.twilioCallSid;

      if (!businessId || !callId) {
        logger.error('Missing required room metadata', { roomMetadata });
        throw new Error('Missing businessId or callId in room metadata');
      }

      // Get business configuration
      const business = await db.getBusiness(businessId);
      if (!business) {
        logger.error('Business not found', { businessId });
        throw new Error('Business not found');
      }

      logger.info('Business loaded', {
        businessId,
        businessName: business.name,
        agentName: business.agent_name,
      });

      // Initialize voice pipeline with Deepgram, Gemini, and ElevenLabs
      const session = new voice.AgentSession({
        // Speech-to-Text: Deepgram Nova-2 (ultra-low latency)
        stt: new DeepgramSTT({
          model: 'nova-2-general',
          language: 'en-US',
          smartFormat: true,
          punctuate: true,
          interimResults: true,
        }),

        // Large Language Model: Google Gemini 1.5 Flash (fast & intelligent)
        llm: new GeminiLLM({
          model: 'gemini-1.5-flash',
          temperature: 0.7,
          maxOutputTokens: 2048,
        }),

        // Text-to-Speech: ElevenLabs (ultra-realistic voice)
        tts: new ElevenLabsTTS({
          voiceId: business.agent_voice || process.env.ELEVENLABS_VOICE_ID,
          model: 'eleven_turbo_v2_5', // Fastest model for <300ms latency
          stability: 0.5,
          similarityBoost: 0.75,
          optimizeStreamingLatency: 3, // Maximum optimization
        }),

        // VAD and turn detection for natural conversation flow
        turnDetection: new livekit.turnDetector.MultilingualModel(),
        vad: ctx.proc.userData.vad! as silero.VAD,
      });

      // Metrics collection for monitoring and optimization
      const usageCollector = new metrics.UsageCollector();

      session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
        metrics.logMetrics(ev.metrics);
        usageCollector.collect(ev.metrics);

        // Update call costs in database
        updateCallCosts(callId, ev.metrics).catch((error) => {
          logger.error('Failed to update call costs', { error, callId });
        });
      });

      // Log usage summary on shutdown
      const logUsage = async () => {
        const summary = usageCollector.getSummary();
        logger.info('Call usage summary', { callId, summary });

        // Update final call stats
        await updateFinalCallStats(callId, summary);
      };

      ctx.addShutdownCallback(logUsage);

      // Track call events
      session.on(voice.AgentSessionEventTypes.UserStartedSpeaking, async () => {
        await db.logCallEvent(callId, 'user_started_speaking', {});
      });

      session.on(voice.AgentSessionEventTypes.UserStoppedSpeaking, async () => {
        await db.logCallEvent(callId, 'user_stopped_speaking', {});
      });

      session.on(voice.AgentSessionEventTypes.AgentStartedSpeaking, async () => {
        await db.logCallEvent(callId, 'agent_started_speaking', {});
      });

      session.on(voice.AgentSessionEventTypes.AgentStoppedSpeaking, async () => {
        await db.logCallEvent(callId, 'agent_stopped_speaking', {});
      });

      // Track transcript
      const transcriptMessages: Array<{ speaker: string; text: string; timestamp: string }> = [];

      session.on(voice.AgentSessionEventTypes.UserSpeechCommitted, async (ev) => {
        transcriptMessages.push({
          speaker: 'user',
          text: ev.text,
          timestamp: new Date().toISOString(),
        });

        // Update call transcript periodically
        await db.updateCall(callId, {
          transcript: transcriptMessages,
        });
      });

      session.on(voice.AgentSessionEventTypes.AgentSpeechCommitted, async (ev) => {
        transcriptMessages.push({
          speaker: 'agent',
          text: ev.text,
          timestamp: new Date().toISOString(),
        });

        await db.updateCall(callId, {
          transcript: transcriptMessages,
        });
      });

      // Start the agent session
      await session.start({
        agent: new SMBVoiceAssistant(businessId, callId, callerPhone, twilioCallSid),
        room: ctx.room,
        inputOptions: {
          // LiveKit Cloud enhanced noise cancellation
          // Use BackgroundVoiceCancellationTelephony for phone calls
          noiseCancellation: BackgroundVoiceCancellation(),
        },
      });

      // Connect to the room
      await ctx.connect();

      // Update call status to in-progress
      await db.updateCall(callId, {
        status: 'in_progress',
        answered_at: new Date().toISOString(),
      });

      logger.info('Agent connected and ready', { callId, roomName: ctx.room.name });

    } catch (error) {
      logger.error('Agent entry error', { error });
      throw error;
    }
  },
});

/**
 * Update call costs based on metrics
 */
async function updateCallCosts(callId: string, metricsData: any): Promise<void> {
  try {
    const costs = {
      cost_stt: calculateSTTCost(metricsData),
      cost_llm: calculateLLMCost(metricsData),
      cost_tts: calculateTTSCost(metricsData),
    };

    const totalCost = costs.cost_stt + costs.cost_llm + costs.cost_tts;

    await db.updateCall(callId, {
      ...costs,
      cost_total: totalCost,
    });
  } catch (error) {
    logger.error('Error updating call costs', { error, callId });
  }
}

/**
 * Calculate STT cost (Deepgram: $0.0043/min)
 */
function calculateSTTCost(metrics: any): number {
  const durationMinutes = (metrics.sttDuration || 0) / 60;
  return Math.round(durationMinutes * 0.0043 * 100); // in cents
}

/**
 * Calculate LLM cost (Gemini 1.5 Flash: free tier, then ~$0.000075/1K tokens)
 */
function calculateLLMCost(metrics: any): number {
  const tokens = (metrics.llmTokensInput || 0) + (metrics.llmTokensOutput || 0);
  return Math.round((tokens / 1000) * 0.000075 * 100); // in cents
}

/**
 * Calculate TTS cost (ElevenLabs: $0.30/1K chars on professional tier)
 */
function calculateTTSCost(metrics: any): number {
  const characters = metrics.ttsCharacters || 0;
  return Math.round((characters / 1000) * 0.30 * 100); // in cents
}

/**
 * Update final call statistics
 */
async function updateFinalCallStats(callId: string, summary: any): Promise<void> {
  try {
    const call = await db.getCall(callId);
    if (!call) return;

    const endedAt = new Date();
    const startedAt = new Date(call.started_at);
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

    await db.updateCall(callId, {
      status: 'completed',
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
    });

    logger.info('Call completed', {
      callId,
      durationSeconds,
      outcome: call.outcome,
    });
  } catch (error) {
    logger.error('Error updating final call stats', { error, callId });
  }
}

// Run the agent worker
cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
