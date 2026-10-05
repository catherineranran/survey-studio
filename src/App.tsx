import { useEffect, useState } from 'react';
import { ConfirmProvider, ErrorBoundary, IconButton, Spinner, ToastProvider } from './components/ui';
import { getBackend, readConfig, type AuthUser, type Backend } from './lib/backend';
import { BackendContext } from './lib/backend/context';
import { useHashPath } from './lib/router';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Respond } from './pages/Respond';
import { Workspace } from './pages/Workspace';

export function App() {
  // Respondent links look like  https://…/survey-studio/?s=<survey id>&PROLIFIC_PID=…
  const respondentId = new URLSearchParams(window.location.search).get('s');
  if (respondentId)
    return (
      <ErrorBoundary label="This survey couldn’t be shown">
        <Respond surveyId={respondentId} />
      </ErrorBoundary>
    );
  return <Admin />;
}

function Admin() {
  const path = useHashPath();
  const [backend, setBackend] = useState<Backend | null>(null);
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    getBackend()
      .then(async (b) => {
        setBackend(b);
        setUser(await b.currentUser());
      })
      .catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => (backend ? backend.onAuthChange(setUser) : undefined), [backend]);

  if (path[0] === 'r' && path[1]) return <Respond surveyId={path[1]} />;
  if (fatal) return <p className="fatal">Survey Studio couldn’t start: {fatal}</p>;
  if (!backend || user === undefined) return <Spinner label="Starting Survey Studio" />;
  if (backend.needsAuth && !user) return <Login backend={backend} allowSignup={readConfig().allowSignup} />;

  return (
    <BackendContext.Provider value={backend}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="app">
            <header className="topbar">
              <a className="brand" href="#/">
                <span className="brand-mark" aria-hidden="true" />
                <span>Survey Studio</span>
              </a>
              <div className="topbar-right">
                {backend.mode === 'local' ? (
                  <span className="mode-pill" title="Surveys and responses are stored in this browser">
                    Browser storage
                  </span>
                ) : (
                  <>
                    <span className="mode-pill mode-cloud" title="Connected to your Supabase database">
                      {user?.email ?? 'Signed in'}
                    </span>
                    <IconButton icon="logout" label="Sign out" onClick={() => void backend.signOut()} />
                  </>
                )}
              </div>
            </header>
            <main className="app-main">{path[0] === 's' && path[1] ? <Workspace key={path[1]} id={path[1]} tab={path[2] ?? 'build'} /> : <Dashboard />}</main>
          </div>
        </ConfirmProvider>
      </ToastProvider>
    </BackendContext.Provider>
  );
}
