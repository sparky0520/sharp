import { useEffect } from 'react';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './App.css';

function App() {
  const dismissWindow = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.hide();
  };

  useEffect(() => {
    const setupShortcut = async () => {
      try {
        await unregisterAll();
        await register('CommandOrControl+Space', async (event) => {
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
      } catch (error) {
        console.error('Failed to register shortcut:', error);
      }
    };

    setupShortcut();

    return () => {
      unregisterAll().catch(console.error);
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
      <p>Press <code>Ctrl+Space</code> globally to toggle this window.</p>
      <button onClick={dismissWindow}>Dismiss (Esc)</button>
    </div>
  );
}

export default App;
