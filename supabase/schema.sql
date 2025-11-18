-- =============================================
-- SMB Voice AI Agent - Supabase Database Schema
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS & AUTHENTICATION
-- =============================================

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- BUSINESSES
-- =============================================

CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,

  -- Agent configuration
  agent_name TEXT DEFAULT 'AI Assistant',
  agent_personality TEXT DEFAULT 'professional',
  system_prompt TEXT DEFAULT 'You are a professional, warm SMB receptionist. Book meetings, capture leads, escalate complex queries. Speak naturally under 20 seconds.',
  agent_voice TEXT DEFAULT 'adam', -- ElevenLabs voice ID

  -- Business hours (JSON format: {"monday": {"open": "09:00", "close": "17:00"}, ...})
  business_hours JSONB DEFAULT '{}',
  timezone TEXT DEFAULT 'America/New_York',

  -- Integrations
  google_calendar_connected BOOLEAN DEFAULT FALSE,
  google_calendar_id TEXT,
  hubspot_api_key TEXT,
  slack_webhook_url TEXT,

  -- Billing
  stripe_customer_id TEXT,
  subscription_status TEXT DEFAULT 'trial', -- trial, active, canceled, past_due
  subscription_plan TEXT DEFAULT 'starter', -- starter, pro, enterprise
  trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '14 days',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster owner lookups
CREATE INDEX idx_businesses_owner_id ON public.businesses(owner_id);

-- =============================================
-- PHONE NUMBERS
-- =============================================

CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  phone_number TEXT UNIQUE NOT NULL, -- E.164 format: +1234567890
  friendly_name TEXT,
  country_code TEXT DEFAULT 'US',

  -- Twilio details
  twilio_sid TEXT UNIQUE,
  twilio_account_sid TEXT,
  capabilities JSONB DEFAULT '{"voice": true, "sms": true}',

  -- Configuration
  is_active BOOLEAN DEFAULT TRUE,
  forward_to TEXT, -- Human phone number for transfers
  greeting_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_phone_numbers_business_id ON public.phone_numbers(business_id);
CREATE INDEX idx_phone_numbers_twilio_sid ON public.phone_numbers(twilio_sid);

-- =============================================
-- CALLS
-- =============================================

CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone_number_id UUID REFERENCES public.phone_numbers(id) ON DELETE SET NULL,

  -- Call details
  direction TEXT NOT NULL, -- inbound, outbound
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  caller_name TEXT,
  caller_email TEXT,

  -- LiveKit session
  livekit_room_name TEXT UNIQUE,
  livekit_session_id TEXT,

  -- Twilio details
  twilio_call_sid TEXT UNIQUE,
  twilio_status TEXT, -- queued, ringing, in-progress, completed, failed, busy, no-answer

  -- Call timing
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  answered_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,

  -- Call outcome
  status TEXT DEFAULT 'in_progress', -- in_progress, completed, failed, abandoned
  outcome TEXT, -- appointment_booked, lead_captured, transferred, voicemail, hung_up
  transferred_to_human BOOLEAN DEFAULT FALSE,

  -- Transcript & Recording
  transcript JSONB DEFAULT '[]', -- Array of {speaker: 'agent|user', text: '...', timestamp: '...'}
  summary TEXT,
  recording_url TEXT,
  recording_duration_seconds INTEGER,

  -- Metadata & Analytics
  sentiment TEXT, -- positive, neutral, negative
  lead_score INTEGER, -- 0-100
  intent_detected TEXT, -- support, sales, inquiry, booking
  tags TEXT[] DEFAULT '{}',
  notes TEXT,

  -- Costs (in cents)
  cost_stt INTEGER DEFAULT 0,
  cost_llm INTEGER DEFAULT 0,
  cost_tts INTEGER DEFAULT 0,
  cost_twilio INTEGER DEFAULT 0,
  cost_total INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_calls_business_id ON public.calls(business_id);
CREATE INDEX idx_calls_phone_number_id ON public.calls(phone_number_id);
CREATE INDEX idx_calls_status ON public.calls(status);
CREATE INDEX idx_calls_started_at ON public.calls(started_at DESC);
CREATE INDEX idx_calls_livekit_room ON public.calls(livekit_room_name);
CREATE INDEX idx_calls_twilio_sid ON public.calls(twilio_call_sid);

-- =============================================
-- LEADS (Captured from calls)
-- =============================================

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,

  -- Lead information
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,

  -- Lead details
  source TEXT DEFAULT 'voice_call',
  status TEXT DEFAULT 'new', -- new, contacted, qualified, converted, lost
  interest_level TEXT, -- high, medium, low

  -- CRM sync
  hubspot_contact_id TEXT,
  salesforce_id TEXT,
  synced_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  notes TEXT,
  tags TEXT[] DEFAULT '{}',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_leads_business_id ON public.leads(business_id);
CREATE INDEX idx_leads_call_id ON public.leads(call_id);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_email ON public.leads(email);
CREATE INDEX idx_leads_phone ON public.leads(phone);

-- =============================================
-- APPOINTMENTS
-- =============================================

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,

  -- Appointment details
  title TEXT NOT NULL,
  description TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER DEFAULT 30,

  -- Attendees
  attendee_name TEXT,
  attendee_email TEXT,
  attendee_phone TEXT,

  -- Calendar sync
  google_calendar_event_id TEXT,
  google_meet_link TEXT,
  ical_uid TEXT,

  -- Status
  status TEXT DEFAULT 'scheduled', -- scheduled, confirmed, canceled, completed, no_show
  reminder_sent BOOLEAN DEFAULT FALSE,

  -- Metadata
  notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_appointments_business_id ON public.appointments(business_id);
CREATE INDEX idx_appointments_scheduled_at ON public.appointments(scheduled_at);
CREATE INDEX idx_appointments_status ON public.appointments(status);

-- =============================================
-- CALL EVENTS (For real-time monitoring)
-- =============================================

CREATE TABLE IF NOT EXISTS public.call_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL, -- participant_joined, speech_started, function_called, transfer_initiated, etc.
  event_data JSONB DEFAULT '{}',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for real-time queries
CREATE INDEX idx_call_events_call_id ON public.call_events(call_id);
CREATE INDEX idx_call_events_created_at ON public.call_events(created_at DESC);

-- =============================================
-- ANALYTICS SNAPSHOTS (Daily aggregates)
-- =============================================

CREATE TABLE IF NOT EXISTS public.analytics_daily (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  date DATE NOT NULL,

  -- Call metrics
  total_calls INTEGER DEFAULT 0,
  inbound_calls INTEGER DEFAULT 0,
  outbound_calls INTEGER DEFAULT 0,
  answered_calls INTEGER DEFAULT 0,
  missed_calls INTEGER DEFAULT 0,
  average_duration_seconds INTEGER DEFAULT 0,

  -- Outcome metrics
  appointments_booked INTEGER DEFAULT 0,
  leads_captured INTEGER DEFAULT 0,
  transfers_to_human INTEGER DEFAULT 0,

  -- Sentiment
  positive_sentiment INTEGER DEFAULT 0,
  neutral_sentiment INTEGER DEFAULT 0,
  negative_sentiment INTEGER DEFAULT 0,

  -- Costs (in cents)
  total_cost INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(business_id, date)
);

-- Index
CREATE INDEX idx_analytics_daily_business_date ON public.analytics_daily(business_id, date DESC);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_daily ENABLE ROW LEVEL SECURITY;

-- Users: Can only see their own profile
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Businesses: Users can only see/manage businesses they own
CREATE POLICY "Business owners can view their businesses" ON public.businesses
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Business owners can update their businesses" ON public.businesses
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Business owners can delete their businesses" ON public.businesses
  FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "Users can create businesses" ON public.businesses
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Phone Numbers: Access through business ownership
CREATE POLICY "Phone numbers visible to business owners" ON public.phone_numbers
  FOR SELECT USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "Phone numbers manageable by business owners" ON public.phone_numbers
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Calls: Access through business ownership
CREATE POLICY "Calls visible to business owners" ON public.calls
  FOR SELECT USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "Calls manageable by business owners" ON public.calls
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Leads: Access through business ownership
CREATE POLICY "Leads visible to business owners" ON public.leads
  FOR SELECT USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "Leads manageable by business owners" ON public.leads
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Appointments: Access through business ownership
CREATE POLICY "Appointments visible to business owners" ON public.appointments
  FOR SELECT USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "Appointments manageable by business owners" ON public.appointments
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Call Events: Access through business ownership
CREATE POLICY "Call events visible to business owners" ON public.call_events
  FOR SELECT USING (
    call_id IN (
      SELECT id FROM public.calls WHERE business_id IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      )
    )
  );

-- Analytics: Access through business ownership
CREATE POLICY "Analytics visible to business owners" ON public.analytics_daily
  FOR SELECT USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to all tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_businesses_updated_at BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_phone_numbers_updated_at BEFORE UPDATE ON public.phone_numbers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_calls_updated_at BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Trigger on auth.users signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- SAMPLE DATA (Optional - for testing)
-- =============================================

-- Insert sample business (commented out for production)
-- INSERT INTO public.businesses (owner_id, name, industry)
-- VALUES ('YOUR_USER_ID', 'Acme Corp', 'Technology');
