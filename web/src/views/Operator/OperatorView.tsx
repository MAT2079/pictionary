import { useState } from 'react';
import { api } from '../../lib/api';
import { Logo } from '../../components/ui';
import OperatorConsole from './OperatorConsole';

export default function OperatorView() {
  const [authed, setAuthed] = useState(false);
  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;
  return <OperatorConsole />;
}

function Login({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onAuthed();
    } catch {
      setError('Wrong password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="w-full max-w-sm animate-fade-up">
        <Logo className="text-3xl" />
        <p className="mt-2 text-muted">Operator Console — enter the password.</p>
        <input
          type="password"
          className="input mt-6"
          placeholder="Operator password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />
        {error && <p className="mt-3 text-coral text-sm">{error}</p>}
        <button className="btn-primary mt-5 w-full" disabled={busy} onClick={submit}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}
