import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { bootstrap } from './app/bootstrap';
import { installedVersion, isNewerThanApp } from './core/storage/db';
import { StorageBlockedScreen } from './app/StorageBlockedScreen';

const root = createRoot(document.getElementById('root')!);

// Never let this build open (and so adjust) a library written by a newer schema.
installedVersion()
  .catch(() => 0)
  .then((v) => {
    if (isNewerThanApp(v)) {
      root.render(<StorageBlockedScreen />);
      return;
    }
    bootstrap();
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
