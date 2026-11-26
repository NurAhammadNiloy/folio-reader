import { useRef, useState } from 'react';
import { Button, Dialog, TextField } from '../../components/ui';

export interface PasswordPrompt {
  ask: (fileName: string, reason: 'required' | 'incorrect') => Promise<string | null>;
  state: { fileName: string; reason: 'required' | 'incorrect' } | null;
  resolve: (pw: string | null) => void;
}

/** Password lives only in component state for the duration of the prompt. */
export function usePasswordPrompt(): PasswordPrompt {
  const [state, setState] = useState<PasswordPrompt['state']>(null);
  const resolver = useRef<((pw: string | null) => void) | null>(null);
  return {
    state,
    ask: (fileName, reason) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setState({ fileName, reason });
      }),
    resolve: (pw) => {
      resolver.current?.(pw);
      resolver.current = null;
      setState(null);
    },
  };
}

export function PasswordDialog({ prompt }: { prompt: PasswordPrompt }) {
  const [pw, setPw] = useState('');
  const close = (value: string | null) => {
    setPw('');
    prompt.resolve(value);
  };
  return (
    <Dialog
      open={!!prompt.state}
      onClose={() => close(null)}
      title="Password required"
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button variant="primary" type="submit" form="pw-form" disabled={!pw}>
            Open
          </Button>
        </>
      }
    >
      <form
        id="pw-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) close(pw);
        }}
      >
        <p className="mb-3">
          “{prompt.state?.fileName}” is password-protected.
          {prompt.state?.reason === 'incorrect' && <strong className="block text-danger">That password was not correct. Try again.</strong>}
        </p>
        <TextField label="Password" type="password" value={pw} onChange={setPw} autoFocus hint="Folio does not store this password. You will be asked again next time you open the book." />
      </form>
    </Dialog>
  );
}
