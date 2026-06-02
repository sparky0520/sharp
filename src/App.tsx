import { useEffect, useState } from 'react';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import './App.css';

function App() {
  const [error, setError] = useState<string | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const dismissWindow = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.hide();
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
      const appWindow = getCurrentWindow();
      await appWindow.show().catch(console.error);
    } finally {
      setIsCapturing(false);
    }
  };

  useEffect(() => {
    const setupShortcut = async () => {
      try {
        await unregisterAll();
        await register('CommandOrControl+Shift+Space', async (event) => {
          if (event.state === 'Pressed') {
            try {
              const appWindow = getCurrentWindow();
              const isVisible = await appWindow.isVisible();
              if (isVisible) {
                await appWindow.hide();
              } else {
                await appWindow.show();
                await appWindow.setFocus();
              }
            } catch (e: any) {
              setError('Shortcut handler error: ' + e.toString());
            }
          }
        });
      } catch (err: any) {
        setError('Failed to register shortcut: ' + err.toString());
      }
    };

    setupShortcut();

    return () => {
      unregisterAll().catch(e => console.error(e));
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissWindow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="container">
      <h1>GlideWin Assistant</h1>
      <p>I am your desktop AI companion.</p>
      <p>Press <code>Ctrl+Shift+Space</code> globally to toggle this window.</p>
      
      <div style={{ margin: '1rem 0', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <button onClick={takeScreenshot} disabled={isCapturing}>
          {isCapturing ? 'Capturing...' : 'Capture Screen'}
        </button>
        <button onClick={dismissWindow}>Dismiss (Esc)</button>
      </div>

      {screenshotPath && (
        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#333', borderRadius: '8px', color: 'white' }}>
          <strong>Screenshot saved to:</strong><br />
          <code style={{ wordBreak: 'break-all' }}>{screenshotPath}</code>
        </div>
      )}

      {error && <div style={{ color: 'red', marginTop: '1rem' }}><strong>Error:</strong> {error}</div>}
    </div>
  );
}

export default App;
