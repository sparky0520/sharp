import { useEffect, useRef, useState } from 'react';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

function App() {
  const [error, setError] = useState<string | null>(null);

  // Visual (screenshot) mode state
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Visual mode (ask GPT with screenshot, streaming)
  const [isAsking, setIsAsking] = useState(false);
  const [gptResponse, setGptResponse] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Agent mode state
  const [agentInput, setAgentInput] = useState('');
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const dismissWindow = async () => {
    try {
      await getCurrentWindow().hide();
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const takeScreenshot = async () => {
    try {
      setError(null);
      setIsCapturing(true);
      setScreenshotPath(null);
      const appWindow = getCurrentWindow();
      await appWindow.hide();
      await new Promise(resolve => setTimeout(resolve, 200));
      const path = await invoke<string>('capture_screen');
      setScreenshotPath(path);
      await appWindow.show();
      await appWindow.setFocus();
    } catch (e: any) {
      setError('Capture failed: ' + e.toString());
      await getCurrentWindow().show().catch(console.error);
    } finally {
      setIsCapturing(false);
    }
  };

  const speakResponse = async (text: string) => {
    try {
      setError(null);
      setIsSpeaking(true);
      await invoke('speak_text', { text });
    } catch (e: any) {
      setError('TTS failed: ' + e.toString());
    } finally {
      setIsSpeaking(false);
    }
  };

  // Visual mode: screenshot + transcript → streaming GPT
  const askGpt = async () => {
    if (!screenshotPath || !transcript) return;
    setError(null);
    setIsAsking(true);
    setGptResponse(null);

    const tokenUnlisten = await listen<string>('gpt-token', (event) => {
      setGptResponse(prev => (prev ?? '') + event.payload);
    });

    try {
      await invoke('ask_gpt_stream', { screenshotPath, transcript });
    } catch (e: any) {
      setError('GPT request failed: ' + e.toString());
    } finally {
      tokenUnlisten();
      setIsAsking(false);
    }
  };

  const transcribeFile = async (filePath: string) => {
    try {
      setIsTranscribing(true);
      setTranscript(null);
      const text = await invoke<string>('transcribe_audio', { filePath });
      setTranscript(text);
      // Auto-fill agent input with transcript for quick agent use
      setAgentInput(text);
    } catch (e: any) {
      setError('Transcription failed: ' + e.toString());
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      try {
        setError(null);
        const path = await invoke<string>('stop_recording');
        transcribeFile(path);
      } catch (e: any) {
        setError('Stop recording failed: ' + e.toString());
      } finally {
        setIsRecording(false);
        setElapsed(0);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    } else {
      try {
        setError(null);
        setTranscript(null);
        setGptResponse(null);
        await invoke<string>('start_recording');
        setIsRecording(true);
        setElapsed(0);
        timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
      } catch (e: any) {
        setError('Start recording failed: ' + e.toString());
      }
    }
  };

  // Agent mode: text (or transcript) + optional screenshot → rig agent with tools
  const sendAgentMessage = async () => {
    const msg = agentInput.trim();
    if (!msg || isAgentThinking) return;

    setAgentInput('');
    setConversation(prev => [...prev, { role: 'user', text: msg }]);

    try {
      setError(null);
      const response = await invoke<string>('agent_chat', {
        message: msg,
        screenshotPath: screenshotPath ?? null,
      });
      setConversation(prev => [...prev, { role: 'assistant', text: response }]);
    } catch (e: any) {
      setError('Agent error: ' + e.toString());
    }
  };

  const clearConversation = async () => {
    await invoke('clear_conversation').catch(console.error);
    setConversation([]);
    setScreenshotPath(null);
    setTranscript(null);
    setGptResponse(null);
    setAgentInput('');
    setError(null);
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Subscribe to agent-thinking events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<boolean>('agent-thinking', (event) => {
      setIsAgentThinking(event.payload);
    }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, isAgentThinking]);

  // Global shortcut
  useEffect(() => {
    const setupShortcut = async () => {
      try {
        await unregisterAll();
        await register('CommandOrControl+Shift+Space', async (event) => {
          if (event.state === 'Pressed') {
            const appWindow = getCurrentWindow();
            const isVisible = await appWindow.isVisible();
            if (isVisible) {
              await appWindow.hide();
            } else {
              await appWindow.show();
              await appWindow.setFocus();
            }
          }
        });
      } catch (err: any) {
        setError('Failed to register shortcut: ' + err.toString());
      }
    };
    setupShortcut();
    return () => { unregisterAll().catch(console.error); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissWindow();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="container">
      <h1>GlideWin</h1>

      {/* ── Controls ── */}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <button onClick={takeScreenshot} disabled={isCapturing} title="Capture screen for context">
          {isCapturing ? 'Capturing...' : screenshotPath ? 'Recapture' : 'Capture Screen'}
        </button>
        <button className={isRecording ? 'recording-btn' : ''} onClick={toggleRecording}>
          {isRecording ? <><span className="recording-dot" />Stop {formatTime(elapsed)}</> : 'Record'}
        </button>
        <button onClick={askGpt} disabled={!screenshotPath || !transcript || isAsking}
          title="Ask GPT with screenshot (streaming, visual mode)">
          {isAsking ? 'Asking...' : 'Ask GPT (Visual)'}
        </button>
        <button onClick={clearConversation} title="Clear conversation and screenshot">Clear</button>
        <button onClick={dismissWindow}>Dismiss</button>
      </div>

      {/* ── Status pills ── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '0.5rem' }}>
        {screenshotPath && (
          <span style={{ fontSize: '0.75rem', background: '#2a4a2a', color: '#7fff7f', padding: '2px 8px', borderRadius: 12 }}>
            Screenshot ready
          </span>
        )}
        {isTranscribing && (
          <span style={{ fontSize: '0.75rem', background: '#1a1a3a', color: '#7f7fff', padding: '2px 8px', borderRadius: 12 }}>
            <span className="transcribing-dot" /> Transcribing...
          </span>
        )}
        {transcript && (
          <span style={{ fontSize: '0.75rem', background: '#2a2a2a', color: '#aaa', padding: '2px 8px', borderRadius: 12 }}>
            Voice: &ldquo;{transcript.slice(0, 60)}{transcript.length > 60 ? '…' : ''}&rdquo;
          </span>
        )}
      </div>

      {/* ── Visual mode response ── */}
      {gptResponse && (
        <div style={{ margin: '0.5rem 0', padding: '0.75rem', background: '#1a1a2a', borderRadius: 8, color: '#c8c8ff', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <strong style={{ fontSize: '0.8rem', color: '#888' }}>GPT (visual)</strong>
            <button onClick={() => speakResponse(gptResponse)} disabled={isSpeaking}
              style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
              {isSpeaking ? 'Speaking...' : '🔊 Speak'}
            </button>
          </div>
          <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{gptResponse}</p>
        </div>
      )}

      {/* ── Agent conversation ── */}
      {conversation.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto', margin: '0.5rem 0', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {conversation.map((msg, i) => (
            <div key={i} style={{
              padding: '0.5rem 0.75rem',
              borderRadius: 8,
              textAlign: 'left',
              background: msg.role === 'user' ? '#2a2a2a' : '#1a2a1a',
              color: msg.role === 'user' ? '#ddd' : '#7fff7f',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
            }}>
              <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '0.2rem' }}>
                {msg.role === 'user' ? 'You' : 'GlideWin'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{msg.text}</div>
              {msg.role === 'assistant' && (
                <button onClick={() => speakResponse(msg.text)} disabled={isSpeaking}
                  style={{ fontSize: '0.7rem', padding: '2px 6px', marginTop: '0.3rem' }}>
                  {isSpeaking ? '...' : '🔊'}
                </button>
              )}
            </div>
          ))}
          {isAgentThinking && (
            <div style={{ padding: '0.5rem 0.75rem', borderRadius: 8, background: '#1a2a1a', color: '#7fff7f', alignSelf: 'flex-start', fontSize: '0.85rem' }}>
              <span className="transcribing-dot" /> Thinking...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* ── Agent input ── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <input
          type="text"
          value={agentInput}
          onChange={e => setAgentInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendAgentMessage()}
          placeholder={screenshotPath ? 'Ask about screen or give a command...' : 'Give a command or ask anything...'}
          disabled={isAgentThinking}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            borderRadius: 8,
            border: '1px solid #555',
            background: '#1a1a1a',
            color: '#fff',
            fontSize: '0.9rem',
          }}
        />
        <button
          onClick={sendAgentMessage}
          disabled={!agentInput.trim() || isAgentThinking}
          style={{ padding: '0.5rem 1rem', fontWeight: 'bold' }}
        >
          {isAgentThinking ? '...' : 'Send'}
        </button>
      </div>
      <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '0.25rem', textAlign: 'left' }}>
        Agent has tools: run PowerShell · open apps{screenshotPath ? ' · screen context attached' : ''}
      </div>

      {error && <div style={{ color: 'red', marginTop: '0.75rem' }}><strong>Error:</strong> {error}</div>}
    </div>
  );
}

export default App;
