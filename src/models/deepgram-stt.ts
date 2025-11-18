/**
 * Deepgram STT Provider for LiveKit Agents
 * Wraps Deepgram Nova-2 for ultra-low latency speech recognition
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { StreamAdapter, stt } from '@livekit/agents';
import logger from '../lib/logger.js';

export interface DeepgramSTTOptions {
  model?: string;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  interimResults?: boolean;
}

export class DeepgramSTT extends stt.STT {
  private client: ReturnType<typeof createClient>;
  private options: DeepgramSTTOptions;

  constructor(options: DeepgramSTTOptions = {}) {
    super({
      streamingSupported: true,
    });

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY environment variable is required');
    }

    this.client = createClient(apiKey);
    this.options = {
      model: options.model || 'nova-2-general',
      language: options.language || 'en-US',
      smartFormat: options.smartFormat !== false,
      punctuate: options.punctuate !== false,
      interimResults: options.interimResults !== false,
    };

    logger.info('Deepgram STT initialized', { options: this.options });
  }

  async recognize(
    buffer: Buffer,
    options?: { language?: string }
  ): Promise<stt.SpeechEvent> {
    try {
      const { result, error } = await this.client.listen.prerecorded.transcribeFile(
        buffer,
        {
          model: this.options.model,
          language: options?.language || this.options.language,
          smart_format: this.options.smartFormat,
          punctuate: this.options.punctuate,
        }
      );

      if (error) {
        throw error;
      }

      const transcript = result.results?.channels[0]?.alternatives[0]?.transcript || '';
      const confidence = result.results?.channels[0]?.alternatives[0]?.confidence || 0;

      return new stt.SpeechEvent({
        type: stt.SpeechEventType.FINAL_TRANSCRIPT,
        alternatives: [
          new stt.SpeechData({
            text: transcript,
            confidence: confidence,
            language: options?.language || this.options.language || '',
          }),
        ],
      });
    } catch (error) {
      logger.error('Deepgram recognition error', { error });
      throw error;
    }
  }

  stream(options?: { language?: string }): stt.SpeechStream {
    const connection = this.client.listen.live({
      model: this.options.model,
      language: options?.language || this.options.language,
      smart_format: this.options.smartFormat,
      punctuate: this.options.punctuate,
      interim_results: this.options.interimResults,
      encoding: 'linear16',
      sample_rate: 16000,
    });

    const stream = new DeepgramSpeechStream(connection);
    return stream;
  }
}

class DeepgramSpeechStream extends stt.SpeechStream {
  private connection: any;
  private adapter: StreamAdapter;

  constructor(connection: any) {
    super();
    this.connection = connection;
    this.adapter = new StreamAdapter();

    // Handle transcription events
    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      try {
        const alternative = data.channel?.alternatives[0];
        if (!alternative) return;

        const transcript = alternative.transcript;
        if (!transcript) return;

        const isFinal = data.is_final || false;
        const confidence = alternative.confidence || 0;

        const event = new stt.SpeechEvent({
          type: isFinal
            ? stt.SpeechEventType.FINAL_TRANSCRIPT
            : stt.SpeechEventType.INTERIM_TRANSCRIPT,
          alternatives: [
            new stt.SpeechData({
              text: transcript,
              confidence: confidence,
              language: data.metadata?.model_info?.language || 'en-US',
            }),
          ],
        });

        this.emit('data', event);
      } catch (error) {
        logger.error('Error processing Deepgram transcript', { error });
      }
    });

    connection.on(LiveTranscriptionEvents.Error, (error: any) => {
      logger.error('Deepgram streaming error', { error });
      this.emit('error', error);
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      this.emit('end');
    });
  }

  async pushFrame(frame: any): Promise<void> {
    if (this.connection) {
      this.connection.send(frame.data);
    }
  }

  async flush(): Promise<void> {
    if (this.connection) {
      this.connection.finish();
    }
  }

  async aclose(): Promise<void> {
    if (this.connection) {
      this.connection.finish();
    }
  }
}
