/**
 * ElevenLabs TTS Provider for LiveKit Agents
 * Wraps ElevenLabs for ultra-realistic voice synthesis
 */

import { ElevenLabsClient, stream } from 'elevenlabs';
import { tts } from '@livekit/agents';
import logger from '../lib/logger.js';

export interface ElevenLabsTTSOptions {
  voiceId?: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  optimizeStreamingLatency?: number;
}

export class ElevenLabsTTS extends tts.TTS {
  private client: ElevenLabsClient;
  private options: ElevenLabsTTSOptions;

  constructor(options: ElevenLabsTTSOptions = {}) {
    super({
      streamingSupported: true,
    });

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is required');
    }

    this.client = new ElevenLabsClient({ apiKey });

    this.options = {
      voiceId: options.voiceId || process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Adam
      model: options.model || 'eleven_turbo_v2_5', // Fastest model
      stability: options.stability ?? 0.5,
      similarityBoost: options.similarityBoost ?? 0.75,
      optimizeStreamingLatency: options.optimizeStreamingLatency ?? 3, // Maximum optimization
    };

    logger.info('ElevenLabs TTS initialized', {
      voiceId: this.options.voiceId,
      model: this.options.model,
    });
  }

  async synthesize(text: string): Promise<tts.SynthesizedAudio> {
    try {
      const audio = await this.client.textToSpeech.convert(this.options.voiceId!, {
        text,
        model_id: this.options.model,
        voice_settings: {
          stability: this.options.stability,
          similarity_boost: this.options.similarityBoost,
        },
        optimize_streaming_latency: this.options.optimizeStreamingLatency,
      });

      // Collect audio chunks
      const chunks: Buffer[] = [];
      for await (const chunk of audio) {
        chunks.push(Buffer.from(chunk));
      }

      const audioData = Buffer.concat(chunks);

      return new tts.SynthesizedAudio({
        data: new Uint8Array(audioData),
        sampleRate: 24000, // ElevenLabs default
        numChannels: 1,
      });
    } catch (error) {
      logger.error('ElevenLabs synthesis error', { error, text });
      throw error;
    }
  }

  stream(text: string): tts.SynthesisStream {
    return new ElevenLabsSynthesisStream(this.client, text, this.options);
  }
}

class ElevenLabsSynthesisStream extends tts.SynthesisStream {
  private client: ElevenLabsClient;
  private text: string;
  private options: ElevenLabsTTSOptions;
  private audioStream: AsyncIterable<Uint8Array> | null = null;

  constructor(client: ElevenLabsClient, text: string, options: ElevenLabsTTSOptions) {
    super();
    this.client = client;
    this.text = text;
    this.options = options;
    this.startStreaming();
  }

  private async startStreaming(): Promise<void> {
    try {
      const audio = await this.client.textToSpeech.convert(this.options.voiceId!, {
        text: this.text,
        model_id: this.options.model,
        voice_settings: {
          stability: this.options.stability,
          similarity_boost: this.options.similarityBoost,
        },
        optimize_streaming_latency: this.options.optimizeStreamingLatency,
      });

      // Stream audio chunks
      for await (const chunk of audio) {
        const audioFrame = new tts.AudioFrame({
          data: new Uint8Array(chunk),
          sampleRate: 24000,
          numChannels: 1,
          samplesPerChannel: chunk.length / 2, // 16-bit audio
        });

        this.emit('data', audioFrame);
      }

      this.emit('end');
    } catch (error) {
      logger.error('ElevenLabs streaming error', { error, text: this.text });
      this.emit('error', error);
    }
  }

  async aclose(): Promise<void> {
    // Cleanup if needed
  }
}
