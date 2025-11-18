/**
 * Google Gemini LLM Provider for LiveKit Agents
 * Wraps Gemini 1.5 Flash for fast, intelligent responses
 */

import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  FunctionDeclarationSchemaType,
} from '@google/generative-ai';
import { llm } from '@livekit/agents';
import logger from '../lib/logger.js';

export interface GeminiLLMOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
}

export class GeminiLLM extends llm.LLM {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private options: GeminiLLMOptions;

  constructor(options: GeminiLLMOptions = {}) {
    super();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.options = {
      model: options.model || 'gemini-1.5-flash',
      temperature: options.temperature ?? 0.7,
      topP: options.topP ?? 0.95,
      maxOutputTokens: options.maxOutputTokens || 2048,
    };

    this.model = this.client.getGenerativeModel({
      model: this.options.model,
      generationConfig: {
        temperature: this.options.temperature,
        topP: this.options.topP,
        maxOutputTokens: this.options.maxOutputTokens,
      },
    });

    logger.info('Gemini LLM initialized', { model: this.options.model });
  }

  async chat(options: llm.ChatOptions): Promise<llm.ChatResponse> {
    try {
      const { messages, tools } = options;

      // Convert LiveKit messages to Gemini format
      const history: Content[] = [];
      let systemInstruction = '';

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemInstruction = msg.content;
          continue;
        }

        history.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      }

      // Convert tools to Gemini function declarations
      const geminiTools = tools ? this.convertToolsToGemini(tools) : undefined;

      // Create chat session
      const chat = this.model.startChat({
        history,
        systemInstruction: systemInstruction || undefined,
        tools: geminiTools,
      });

      // Get the last user message
      const lastMessage = messages[messages.length - 1];
      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response;

      // Check for function calls
      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        const toolCalls = functionCalls.map((fc: any) => ({
          id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'function' as const,
          function: {
            name: fc.name,
            arguments: JSON.stringify(fc.args),
          },
        }));

        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                toolCalls,
              },
              finishReason: 'tool_calls',
            },
          ],
        };
      }

      // Regular text response
      const text = response.text();

      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: text,
            },
            finishReason: 'stop',
          },
        ],
      };
    } catch (error) {
      logger.error('Gemini chat error', { error });
      throw error;
    }
  }

  private convertToolsToGemini(tools: Record<string, llm.Tool>): any[] {
    return Object.entries(tools).map(([name, tool]) => ({
      functionDeclarations: [
        {
          name,
          description: tool.description,
          parameters: this.convertZodSchemaToGemini(tool.parameters),
        },
      ],
    }));
  }

  private convertZodSchemaToGemini(schema: any): any {
    // Convert Zod schema to Gemini function parameters format
    const shape = schema._def?.shape?.() || {};
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as any;
      const fieldDef = zodField._def;

      // Determine if field is optional
      const isOptional = fieldDef.typeName === 'ZodOptional';
      if (!isOptional) {
        required.push(key);
      }

      // Get the actual type (unwrap optional if needed)
      const actualType = isOptional ? fieldDef.innerType : zodField;
      const actualDef = actualType._def;

      // Convert Zod type to Gemini type
      let type = FunctionDeclarationSchemaType.STRING;
      if (actualDef.typeName === 'ZodNumber') {
        type = FunctionDeclarationSchemaType.NUMBER;
      } else if (actualDef.typeName === 'ZodBoolean') {
        type = FunctionDeclarationSchemaType.BOOLEAN;
      } else if (actualDef.typeName === 'ZodArray') {
        type = FunctionDeclarationSchemaType.ARRAY;
      } else if (actualDef.typeName === 'ZodObject') {
        type = FunctionDeclarationSchemaType.OBJECT;
      }

      properties[key] = {
        type,
        description: actualDef.description || '',
      };

      // Handle enums
      if (actualDef.typeName === 'ZodEnum') {
        properties[key].enum = actualDef.values;
      }
    }

    return {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties,
      required,
    };
  }
}
