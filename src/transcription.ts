import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import {
  downloadMediaMessage,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  path.join(process.cwd(), 'data', 'models', 'ggml-large-v3-turbo.bin');

const envVars = readEnvFile(['GROQ_API_KEY']);
const GROQ_API_KEY = process.env.GROQ_API_KEY || envVars.GROQ_API_KEY || '';

const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

/**
 * Transcribe audio via Groq API (whisper-large-v3-turbo).
 * Returns transcript or null on failure.
 */
async function transcribeWithGroq(audioBuffer: Buffer): Promise<string | null> {
  try {
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'zh');

    const res = await fetch(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
      },
    );

    if (!res.ok) {
      logger.warn(
        { status: res.status, body: await res.text() },
        'Groq transcription API error',
      );
      return null;
    }

    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch (err) {
    logger.warn({ err }, 'Groq transcription failed');
    return null;
  }
}

/**
 * Transcribe audio via local whisper.cpp.
 * Returns transcript or null on failure.
 */
async function transcribeWithWhisperCppLocal(
  audioBuffer: Buffer,
): Promise<string | null> {
  const tmpDir = os.tmpdir();
  const id = `nanoclaw-voice-${Date.now()}`;
  const tmpOgg = path.join(tmpDir, `${id}.ogg`);
  const tmpWav = path.join(tmpDir, `${id}.wav`);

  try {
    fs.writeFileSync(tmpOgg, audioBuffer);

    // Convert ogg/opus to 16kHz mono WAV (required by whisper.cpp)
    await execFileAsync(
      'ffmpeg',
      ['-i', tmpOgg, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', tmpWav],
      { timeout: 30_000 },
    );

    const { stdout } = await execFileAsync(
      WHISPER_BIN,
      ['-m', WHISPER_MODEL, '-f', tmpWav, '-l', 'zh', '--no-timestamps', '-nt'],
      { timeout: 120_000 },
    );

    const transcript = stdout.trim();
    return transcript || null;
  } catch (err) {
    logger.warn({ err }, 'whisper.cpp transcription failed');
    return null;
  } finally {
    for (const f of [tmpOgg, tmpWav]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* best effort cleanup */
      }
    }
  }
}

/**
 * Transcribe audio buffer. Tries Groq API first (fast), falls back to
 * local whisper.cpp if Groq is unavailable or fails.
 */
export async function transcribeWithWhisperCpp(
  audioBuffer: Buffer,
): Promise<string | null> {
  if (GROQ_API_KEY) {
    const result = await transcribeWithGroq(audioBuffer);
    if (result) {
      logger.info(
        { length: result.length, provider: 'groq' },
        'Transcription complete',
      );
      return result;
    }
    logger.info('Groq failed, falling back to local whisper.cpp');
  }

  const result = await transcribeWithWhisperCppLocal(audioBuffer);
  if (result) {
    logger.info(
      { length: result.length, provider: 'whisper.cpp' },
      'Transcription complete',
    );
  }
  return result;
}

export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      logger.warn('Failed to download audio message');
      return FALLBACK_MESSAGE;
    }

    logger.info({ bytes: buffer.length }, 'Downloaded audio message');

    const transcript = await transcribeWithWhisperCpp(buffer);

    if (!transcript) {
      return FALLBACK_MESSAGE;
    }

    return transcript.trim();
  } catch (err) {
    logger.warn({ err }, 'Transcription error');
    return FALLBACK_MESSAGE;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
