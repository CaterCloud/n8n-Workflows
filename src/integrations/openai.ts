import OpenAI from 'openai';
import { env } from '../env.js';
import { ConfigError } from '../lib/errors.js';

let client: OpenAI | undefined;

export function openai(): OpenAI {
  if (client) return client;
  const { OPENAI_API_KEY } = env();
  if (!OPENAI_API_KEY) throw new ConfigError('OPENAI_API_KEY is not set');
  client = new OpenAI({ apiKey: OPENAI_API_KEY, maxRetries: 3 });
  return client;
}

export interface CompletionRequest {
  system?: string;
  user: string;
  model?: string;
  /** Ask the API for a JSON object rather than relying on prompt discipline. */
  json?: boolean;
  temperature?: number;
}

/** One chat completion, returning the assistant's text content. */
export async function complete(req: CompletionRequest): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  messages.push({ role: 'user', content: req.user });

  const res = await openai().chat.completions.create({
    model: req.model ?? env().OPENAI_MODEL,
    messages,
    ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
  });

  return res.choices[0]?.message?.content ?? '';
}

/** Test hook. */
export function setOpenAiForTesting(value: OpenAI | undefined): void {
  client = value;
}
