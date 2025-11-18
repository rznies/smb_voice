# 📋 Complete Setup Guide - SMB Voice AI Platform

**Step-by-step instructions to deploy your production Voice AI platform in < 1 hour**

---

## 🎯 Overview

This guide will walk you through:
1. Creating all required accounts (free tiers)
2. Getting API keys
3. Setting up the database
4. Deploying to production
5. Testing your first call

**Time Required**: ~45-60 minutes
**Cost**: $0 to start (all services have free tiers)

---

## Step 1: Create Accounts (15 min)

### 1.1 LiveKit Cloud
1. Go to [cloud.livekit.io](https://cloud.livekit.io)
2. Sign up with GitHub or email
3. Create a new project → Name it "SMB Voice AI"
4. Go to **Settings → Keys**
5. Create a new API key
6. Save: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

### 1.2 Deepgram
1. Go to [deepgram.com](https://deepgram.com)
2. Sign up (free 200 min/month)
3. Go to **Console → API Keys**
4. Create a new key → Save: `DEEPGRAM_API_KEY`

### 1.3 Google Gemini
1. Go to [ai.google.dev](https://ai.google.dev)
2. Click "Get API key in Google AI Studio"
3. Create API key → Save: `GEMINI_API_KEY`

### 1.4 ElevenLabs
1. Go to [elevenlabs.io](https://elevenlabs.io)
2. Sign up (free 10k chars/month)
3. Go to **Profile → API Keys**
4. Generate new key → Save: `ELEVENLABS_API_KEY`

### 1.5 Twilio
1. Go to [twilio.com/try-twilio](https://www.twilio.com/try-twilio)
2. Sign up (get $15 free credit)
3. Go to **Console → Account Info**
4. Save: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
5. Go to **Phone Numbers → Buy a Number** (costs ~$1/month)
6. Save the number: `TWILIO_PHONE_NUMBER`

### 1.6 Supabase
1. Go to [supabase.com](https://supabase.com)
2. Sign up with GitHub
3. Create new project → Name it "SMB Voice AI"
4. Wait ~2 minutes for database provisioning
5. Go to **Settings → API**
6. Save: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 2: Configure Environment (5 min)

### 2.1 Create .env.local
```bash
cd smb_voice
cp .env.example .env.local
```

### 2.2 Edit .env.local
```bash
# Open in your editor
nano .env.local
# Or
code .env.local
```

### 2.3 Fill in ALL keys
Replace the placeholder values with your actual API keys from Step 1.

**Critical keys** (required):
- LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
- DEEPGRAM_API_KEY
- GEMINI_API_KEY
- ELEVENLABS_API_KEY
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

**Optional keys** (for advanced features):
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (for Calendar)
- HUBSPOT_API_KEY (for CRM sync)
- STRIPE_SECRET_KEY (for billing)

---

## Step 3: Setup Database (10 min)

### 3.1 Run Database Schema
1. Go to Supabase Dashboard → **SQL Editor**
2. Open `supabase/schema.sql` in your code editor
3. Copy the entire contents
4. Paste into Supabase SQL Editor
5. Click **Run**
6. Wait ~30 seconds for completion

### 3.2 Verify Tables Created
Go to **Table Editor** - you should see:
- users
- businesses
- phone_numbers
- calls
- leads
- appointments
- call_events
- analytics_daily

### 3.3 Create Your First Business
In SQL Editor, run:
```sql
-- Replace 'your-email@example.com' with your actual email
DO $$
DECLARE
  user_id uuid;
  business_id uuid;
BEGIN
  -- Get or create user
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    gen_random_uuid(),
    'your-email@example.com',
    'Your Name'
  )
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING id INTO user_id;

  -- Create business
  INSERT INTO public.businesses (
    owner_id,
    name,
    industry,
    agent_name,
    agent_personality,
    system_prompt
  ) VALUES (
    user_id,
    'My Business',
    'General',
    'Alex',
    'professional',
    'You are Alex, a professional and friendly AI receptionist. Help customers book appointments, answer questions, and capture leads.'
  )
  RETURNING id INTO business_id;

  -- Output the IDs
  RAISE NOTICE 'User ID: %', user_id;
  RAISE NOTICE 'Business ID: %', business_id;
END $$;
```

**Save the Business ID** - you'll need it next!

### 3.4 Add Your Phone Number
```sql
-- Replace with your Twilio phone number and business ID
INSERT INTO public.phone_numbers (
  business_id,
  phone_number,
  friendly_name,
  twilio_account_sid,
  is_active
) VALUES (
  'your-business-id-from-above',
  '+15551234567', -- Your Twilio number
  'Main Line',
  'your-twilio-account-sid',
  true
);
```

---

## Step 4: Deploy to Production (20 min)

### 4.1 Install Dependencies
```bash
pnpm install
```

### 4.2 Install Fly.io CLI
```bash
# Mac/Linux
curl -L https://fly.io/install.sh | sh

# Windows
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"

# Login
fly auth login
```

### 4.3 Deploy Agent Worker
```bash
# Initialize (first time only)
fly apps create smb-voice-agent

# Set secrets
fly secrets set \
  LIVEKIT_URL="$(grep LIVEKIT_URL .env.local | cut -d '=' -f2)" \
  LIVEKIT_API_KEY="$(grep LIVEKIT_API_KEY .env.local | cut -d '=' -f2)" \
  LIVEKIT_API_SECRET="$(grep LIVEKIT_API_SECRET .env.local | cut -d '=' -f2)" \
  DEEPGRAM_API_KEY="$(grep DEEPGRAM_API_KEY .env.local | cut -d '=' -f2)" \
  GEMINI_API_KEY="$(grep GEMINI_API_KEY .env.local | cut -d '=' -f2)" \
  ELEVENLABS_API_KEY="$(grep ELEVENLABS_API_KEY .env.local | cut -d '=' -f2)" \
  SUPABASE_URL="$(grep SUPABASE_URL .env.local | cut -d '=' -f2)" \
  SUPABASE_SERVICE_ROLE_KEY="$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d '=' -f2)"

# Deploy
fly deploy

# Verify
fly status
```

### 4.4 Deploy API Server
```bash
# Initialize (first time only)
fly apps create smb-voice-api

# Set secrets
fly secrets set \
  LIVEKIT_URL="$(grep LIVEKIT_URL .env.local | cut -d '=' -f2)" \
  LIVEKIT_API_KEY="$(grep LIVEKIT_API_KEY .env.local | cut -d '=' -f2)" \
  LIVEKIT_API_SECRET="$(grep LIVEKIT_API_SECRET .env.local | cut -d '=' -f2)" \
  TWILIO_ACCOUNT_SID="$(grep TWILIO_ACCOUNT_SID .env.local | cut -d '=' -f2)" \
  TWILIO_AUTH_TOKEN="$(grep TWILIO_AUTH_TOKEN .env.local | cut -d '=' -f2)" \
  TWILIO_WEBHOOK_URL="https://smb-voice-api.fly.dev" \
  SUPABASE_URL="$(grep SUPABASE_URL .env.local | cut -d '=' -f2)" \
  SUPABASE_SERVICE_ROLE_KEY="$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d '=' -f2)" \
  --config fly-api.toml

# Deploy
fly deploy --config fly-api.toml

# Get your API URL
fly status --config fly-api.toml
# Note the URL - e.g., https://smb-voice-api.fly.dev
```

### 4.5 Test Health Check
```bash
curl https://smb-voice-api.fly.dev/health
# Should return: {"status":"healthy","timestamp":"..."}
```

---

## Step 5: Configure Twilio (5 min)

### 5.1 Set Webhook URL
1. Go to [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Click your phone number
3. Under **Voice & Fax** → **A Call Comes In**:
   - Select: **Webhook**
   - URL: `https://smb-voice-api.fly.dev/api/twilio/inbound`
   - Method: **HTTP POST**
4. Under **Status Callback URL**:
   - URL: `https://smb-voice-api.fly.dev/api/twilio/status`
   - Method: **HTTP POST**
5. Click **Save**

### 5.2 Verify Configuration
```bash
# Call your Twilio number and see if it connects
# Check logs:
fly logs --config fly-api.toml
```

---

## Step 6: Test Your First Call! (5 min)

### 6.1 Make a Test Call
1. Call your Twilio phone number
2. The AI agent should answer within 2-3 seconds
3. Say "Hi, I'd like to book an appointment"
4. The agent will ask for details
5. Provide a date, time, name, and email
6. The appointment should be booked!

### 6.2 Verify in Database
```sql
-- In Supabase SQL Editor
SELECT * FROM calls ORDER BY created_at DESC LIMIT 5;
SELECT * FROM appointments ORDER BY created_at DESC LIMIT 5;
SELECT * FROM call_events ORDER BY created_at DESC LIMIT 10;
```

### 6.3 Check Logs
```bash
# Agent logs
fly logs

# API logs
fly logs --config fly-api.toml
```

---

## Step 7: Advanced Configuration (Optional)

### 7.1 Google Calendar Integration
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials
5. Add credentials to `.env.local`:
   ```bash
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-secret
   GOOGLE_REDIRECT_URI=https://smb-voice-api.fly.dev/api/auth/google/callback
   ```
6. Update in database:
   ```sql
   UPDATE businesses
   SET
     google_calendar_connected = true,
     google_calendar_id = 'your-calendar-id@gmail.com'
   WHERE id = 'your-business-id';
   ```

### 7.2 HubSpot CRM Sync
1. Go to [HubSpot](https://app.hubspot.com)
2. Create private app → Get API key
3. Update database:
   ```sql
   UPDATE businesses
   SET hubspot_api_key = 'pat-na1-your-key'
   WHERE id = 'your-business-id';
   ```

### 7.3 Custom Voice (ElevenLabs)
1. Go to [ElevenLabs Voice Library](https://elevenlabs.io/app/voice-library)
2. Browse voices → Click "Use"
3. Copy Voice ID
4. Update database:
   ```sql
   UPDATE businesses
   SET agent_voice = 'voice-id-here'
   WHERE id = 'your-business-id';
   ```

---

## 🎉 Congratulations!

Your production Voice AI platform is live!

### What You've Built:
- ✅ 24/7 AI receptionist answering real phone calls
- ✅ Appointment booking with Google Calendar
- ✅ Lead capture with CRM sync
- ✅ Real-time transcription and logging
- ✅ Production-ready infrastructure on Fly.io
- ✅ Scalable to 1000s of concurrent calls

### Next Steps:
1. **Monitor**: Watch calls in Supabase dashboard
2. **Optimize**: Adjust system prompts for your business
3. **Scale**: Add more phone numbers and businesses
4. **Build**: Create the Next.js dashboard (coming soon)

---

## 📞 Test Scenarios

Try these with your agent:

### Scenario 1: Book an Appointment
**You**: "Hi, I'd like to schedule a meeting"
**Agent**: "I'd be happy to help you schedule a meeting. What day works best for you?"
**You**: "Next Monday at 2 PM"
**Agent**: "Great! May I have your name?"
**You**: "John Smith"
**Agent**: "And what email should I send the confirmation to?"
**You**: "john@example.com"
**Agent**: *Books appointment* ✅

### Scenario 2: Capture a Lead
**You**: "I'm interested in your services"
**Agent**: "Wonderful! I'd love to help. What's your name?"
**You**: "Sarah Johnson"
**Agent**: "Nice to meet you, Sarah. What's the best email to send you more information?"
**You**: "sarah@company.com"
**Agent**: *Creates lead in CRM* ✅

### Scenario 3: Transfer to Human
**You**: "I need to speak to someone about my account"
**Agent**: "I understand, let me connect you with a team member who can help with your account."
**Agent**: *Initiates transfer* ✅

---

## 🐛 Troubleshooting

### Issue: Agent doesn't answer
**Solution**:
```bash
# Check agent is running
fly status

# Check logs for errors
fly logs

# Restart if needed
fly apps restart smb-voice-agent
```

### Issue: "Business not found" error
**Solution**:
```sql
-- Verify business exists
SELECT * FROM businesses;

-- Check phone_number mapping
SELECT * FROM phone_numbers WHERE phone_number = '+YOUR_TWILIO_NUMBER';
```

### Issue: Poor call quality
**Solution**:
1. Check your internet connection
2. Verify Deepgram API key is valid
3. Check ElevenLabs quota hasn't been exceeded
4. Review logs for latency issues

### Issue: Appointments not booking
**Solution**:
1. Verify Google Calendar API is enabled
2. Check OAuth credentials are correct
3. Ensure calendar ID is set in business settings
4. Review logs for Google API errors

---

## 💰 Cost Monitoring

### View Usage
```sql
-- Total calls this month
SELECT
  COUNT(*) as total_calls,
  SUM(duration_seconds) / 60 as total_minutes,
  SUM(cost_total) / 100.0 as total_cost_dollars
FROM calls
WHERE started_at >= date_trunc('month', CURRENT_DATE);

-- Cost breakdown
SELECT
  SUM(cost_stt) / 100.0 as stt_cost,
  SUM(cost_llm) / 100.0 as llm_cost,
  SUM(cost_tts) / 100.0 as tts_cost,
  SUM(cost_twilio) / 100.0 as twilio_cost,
  SUM(cost_total) / 100.0 as total_cost
FROM calls
WHERE started_at >= date_trunc('month', CURRENT_DATE);
```

### Set Budget Alerts
Create a PostgreSQL function to alert when costs exceed threshold:
```sql
CREATE OR REPLACE FUNCTION check_monthly_budget()
RETURNS void AS $$
DECLARE
  monthly_cost numeric;
  budget_limit numeric := 100.00; -- $100/month limit
BEGIN
  SELECT SUM(cost_total) / 100.0 INTO monthly_cost
  FROM calls
  WHERE started_at >= date_trunc('month', CURRENT_DATE);

  IF monthly_cost > budget_limit THEN
    RAISE WARNING 'Monthly budget exceeded: $%', monthly_cost;
    -- Add notification logic here (email, Slack, etc.)
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## 📚 Additional Resources

- [LiveKit Agents Documentation](https://docs.livekit.io/agents)
- [Twilio Voice API Guide](https://www.twilio.com/docs/voice)
- [Deepgram API Reference](https://developers.deepgram.com)
- [Gemini API Documentation](https://ai.google.dev/docs)
- [ElevenLabs API Docs](https://elevenlabs.io/docs)
- [Supabase Guides](https://supabase.com/docs)

---

**Need help? Open an issue on GitHub or contact support!** 🚀
