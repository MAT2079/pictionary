import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom';
import './index.css';
import { Logo, Center } from './components/ui';
import PhoneView from './views/Phone/PhoneView';
import OperatorView from './views/Operator/OperatorView';
import PrompterView from './views/Prompter/PrompterView';
import PresentView from './views/Present/PresentView';

function Landing() {
  const links = [
    { to: '/play', label: 'Phone / Play', desc: 'Champions join here from their phones' },
    { to: '/present', label: 'Presentation', desc: 'Fullscreen on the projector' },
    { to: '/prompt', label: 'Prompter Station', desc: 'The host machine for composing' },
    { to: '/operator', label: 'Operator Console', desc: 'Run the show (password-gated)' },
  ];
  return (
    <Center>
      <div className="w-full max-w-xl animate-fade-up">
        <Logo className="text-4xl" />
        <p className="mt-2 text-muted">Pick the surface for this device.</p>
        <div className="mt-8 grid gap-3">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="card p-5 hover:border-violet transition group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-xl font-semibold">{l.label}</div>
                  <div className="text-sm text-muted">{l.desc}</div>
                </div>
                <span className="text-violet-soft group-hover:translate-x-1 transition">→</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Center>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/play', element: <PhoneView /> },
  { path: '/present', element: <PresentView /> },
  { path: '/prompt', element: <PrompterView /> },
  { path: '/operator', element: <OperatorView /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
