/**
 * Express API Server for SMB Voice AI Platform
 * Handles Twilio webhooks, LiveKit room creation, and authentication
 */

import express, { Request, Response, NextFunction } from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import twilio from 'twilio';
import { db } from '../lib/database.js';
import logger from '../lib/logger.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.API_PORT || 3001;
const HOST = process.env.API_HOST || '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  logger.info('API Request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// LiveKit configuration
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/**
 * TWILIO INBOUND CALL WEBHOOK
 * Handles incoming phone calls and creates LiveKit room
 */
app.post('/api/twilio/inbound', async (req: Request, res: Response) => {
  try {
    const { From, To, CallSid } = req.body;

    logger.info('Inbound call received', { from: From, to: To, callSid: CallSid });

    // Find the phone number configuration
    const phoneNumber = await db.getPhoneNumber(To);
    if (!phoneNumber) {
      logger.error('Phone number not found', { to: To });
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Sorry, this number is not configured. Please contact support.</Say>
          <Hangup/>
        </Response>`);
    }

    // Get business details
    const business = await db.getBusiness(phoneNumber.business_id);
    if (!business) {
      logger.error('Business not found', { businessId: phoneNumber.business_id });
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Sorry, this service is temporarily unavailable.</Say>
          <Hangup/>
        </Response>`);
    }

    // Create call record in database
    const call = await db.createCall({
      business_id: phoneNumber.business_id,
      phone_number_id: phoneNumber.id,
      direction: 'inbound',
      from_number: From,
      to_number: To,
      twilio_call_sid: CallSid,
      twilio_status: 'in-progress',
      status: 'in_progress',
    });

    logger.info('Call record created', { callId: call.id });

    // Create unique LiveKit room
    const roomName = `call-${call.id}`;

    // Create room with metadata
    const room = await roomService.createRoom({
      name: roomName,
      emptyTimeout: 300, // 5 minutes
      maxParticipants: 2,
      metadata: JSON.stringify({
        businessId: business.id,
        callId: call.id,
        callerPhone: From,
        twilioCallSid: CallSid,
      }),
    });

    logger.info('LiveKit room created', { roomName, roomSid: room.sid });

    // Update call with room name
    await db.updateCall(call.id, {
      livekit_room_name: roomName,
      livekit_session_id: room.sid,
    });

    // Generate LiveKit token for Twilio participant
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: `caller-${From}`,
      name: From,
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();

    // TwiML response to stream audio to LiveKit
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        ${phoneNumber.greeting_message ? `<Say>${phoneNumber.greeting_message}</Say>` : ''}
        <Connect>
          <Stream url="wss://${LIVEKIT_URL.replace('wss://', '').replace('https://', '')}/twilio?access_token=${jwt}">
            <Parameter name="room" value="${roomName}"/>
          </Stream>
        </Connect>
      </Response>`;

    res.type('text/xml').send(twimlResponse);

    // Log the event
    await db.logCallEvent(call.id, 'call_started', {
      from: From,
      to: To,
      twilioCallSid: CallSid,
    });

  } catch (error) {
    logger.error('Error handling inbound call', { error });
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Sorry, we encountered an error. Please try again later.</Say>
        <Hangup/>
      </Response>`);
  }
});

/**
 * TWILIO OUTBOUND CALL API
 * Initiates an outbound call
 */
app.post('/api/twilio/outbound', async (req: Request, res: Response) => {
  try {
    const { businessId, toNumber, fromNumber } = req.body;

    if (!businessId || !toNumber) {
      return res.status(400).json({ error: 'businessId and toNumber are required' });
    }

    logger.info('Initiating outbound call', { businessId, toNumber, fromNumber });

    // Get business
    const business = await db.getBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Get phone number to use
    const { data: phoneNumbers } = await db.client
      .from('phone_numbers')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .limit(1);

    if (!phoneNumbers || phoneNumbers.length === 0) {
      return res.status(400).json({ error: 'No active phone number found for business' });
    }

    const phoneNumber = phoneNumbers[0];
    const callFromNumber = fromNumber || phoneNumber.phone_number;

    // Create call record
    const call = await db.createCall({
      business_id: businessId,
      phone_number_id: phoneNumber.id,
      direction: 'outbound',
      from_number: callFromNumber,
      to_number: toNumber,
      status: 'in_progress',
    });

    // Create LiveKit room
    const roomName = `call-${call.id}`;
    const room = await roomService.createRoom({
      name: roomName,
      emptyTimeout: 300,
      maxParticipants: 2,
      metadata: JSON.stringify({
        businessId: business.id,
        callId: call.id,
        callerPhone: toNumber,
      }),
    });

    // Update call with room info
    await db.updateCall(call.id, {
      livekit_room_name: roomName,
      livekit_session_id: room.sid,
    });

    // Initiate Twilio call
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const twilioCall = await twilioClient.calls.create({
      from: callFromNumber,
      to: toNumber,
      url: `${process.env.TWILIO_WEBHOOK_URL}/api/twilio/outbound-connect?callId=${call.id}&roomName=${roomName}`,
      statusCallback: `${process.env.TWILIO_WEBHOOK_URL}/api/twilio/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    // Update call with Twilio SID
    await db.updateCall(call.id, {
      twilio_call_sid: twilioCall.sid,
      twilio_status: twilioCall.status,
    });

    logger.info('Outbound call initiated', { callId: call.id, twilioSid: twilioCall.sid });

    res.json({
      success: true,
      callId: call.id,
      twilioCallSid: twilioCall.sid,
      roomName,
    });

  } catch (error) {
    logger.error('Error initiating outbound call', { error });
    res.status(500).json({ error: 'Failed to initiate call' });
  }
});

/**
 * TWILIO OUTBOUND CALL CONNECT
 * TwiML to connect outbound call to LiveKit
 */
app.post('/api/twilio/outbound-connect', async (req: Request, res: Response) => {
  try {
    const { callId, roomName } = req.query;

    logger.info('Connecting outbound call', { callId, roomName });

    // Generate LiveKit token
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: `outbound-caller-${callId}`,
      name: `Outbound Call ${callId}`,
    });

    token.addGrant({
      room: roomName as string,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();

    // TwiML to stream to LiveKit
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${LIVEKIT_URL.replace('wss://', '').replace('https://', '')}/twilio?access_token=${jwt}">
            <Parameter name="room" value="${roomName}"/>
          </Stream>
        </Connect>
      </Response>`;

    res.type('text/xml').send(twimlResponse);

  } catch (error) {
    logger.error('Error connecting outbound call', { error });
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Sorry, we encountered an error.</Say>
        <Hangup/>
      </Response>`);
  }
});

/**
 * TWILIO CALL STATUS CALLBACK
 * Handles call status updates from Twilio
 */
app.post('/api/twilio/status', async (req: Request, res: Response) => {
  try {
    const { CallSid, CallStatus, CallDuration } = req.body;

    logger.info('Call status update', { callSid: CallSid, status: CallStatus });

    // Find call by Twilio SID
    const { data: calls } = await db.client
      .from('calls')
      .select('*')
      .eq('twilio_call_sid', CallSid)
      .limit(1);

    if (!calls || calls.length === 0) {
      logger.warn('Call not found for status update', { callSid: CallSid });
      return res.sendStatus(200);
    }

    const call = calls[0];

    // Update call status
    const updates: any = {
      twilio_status: CallStatus,
    };

    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
      updates.ended_at = new Date().toISOString();
      updates.status = CallStatus === 'completed' ? 'completed' : 'failed';
      if (CallDuration) {
        updates.duration_seconds = parseInt(CallDuration);
      }
    }

    await db.updateCall(call.id, updates);

    // Log the event
    await db.logCallEvent(call.id, 'status_update', {
      status: CallStatus,
      duration: CallDuration,
    });

    res.sendStatus(200);

  } catch (error) {
    logger.error('Error handling status callback', { error });
    res.sendStatus(200); // Always return 200 to Twilio
  }
});

/**
 * GET LIVEKIT TOKEN
 * Generate a LiveKit access token for web/mobile clients
 */
app.post('/api/livekit/token', async (req: Request, res: Response) => {
  try {
    const { roomName, participantName, participantIdentity } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({ error: 'roomName and participantName are required' });
    }

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantIdentity || `participant-${Date.now()}`,
      name: participantName,
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();

    res.json({
      token: jwt,
      url: LIVEKIT_URL,
      roomName,
    });

  } catch (error) {
    logger.error('Error generating LiveKit token', { error });
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

/**
 * GET CALL DETAILS
 * Retrieve call information
 */
app.get('/api/calls/:callId', async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;

    const call = await db.getCall(callId);
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    res.json(call);

  } catch (error) {
    logger.error('Error retrieving call', { error });
    res.status(500).json({ error: 'Failed to retrieve call' });
  }
});

/**
 * GET BUSINESS CALLS
 * Retrieve calls for a business
 */
app.get('/api/businesses/:businessId/calls', async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const calls = await db.getCallsByBusiness(businessId, limit);

    res.json({
      calls,
      count: calls.length,
    });

  } catch (error) {
    logger.error('Error retrieving business calls', { error });
    res.status(500).json({ error: 'Failed to retrieve calls' });
  }
});

/**
 * Error handling middleware
 */
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err, path: req.path });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  logger.info(`API Server started`, {
    port: PORT,
    host: HOST,
    env: process.env.NODE_ENV,
    livekitUrl: LIVEKIT_URL,
  });
});

export default app;
