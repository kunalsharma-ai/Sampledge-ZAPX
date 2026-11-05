'use client';
/**
 * Voice command button (blueprint phase 2). Uses the browser's own speech recognition; the words
 * are turned into a command by `parseVoiceCommand`. Edits go to the AI architect as an instruction,
 * which drafts a change set for review. Not offered when the browser has no speech recognition.
 */
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { parseVoiceCommand, type VoiceCommand } from '@zapx/logic-engine';

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

function recognizerClass(): (new () => Recognizer) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceCommandButton({ language, onCommand }: { language: string; onCommand: (c: VoiceCommand, heard: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognizer | null>(null);
  useEffect(() => {
    setAvailable(!!recognizerClass());
    return () => rec.current?.stop();
  }, []);
  if (!available) return null;

  const toggle = () => {
    if (listening) return rec.current?.stop();
    const Ctor = recognizerClass()!;
    const r = new Ctor();
    r.lang = language || 'en';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      const heard = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(' ')
        .trim();
      onCommand(parseVoiceCommand(heard), heard);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      title='Say "open the programmer", "save draft", or an edit such as "add an age question on page 1"'
    >
      {listening ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />} {listening ? 'Listening…' : 'Voice'}
    </button>
  );
}
