import { useEffect, useRef } from 'react';
import { mount, type UsePayload } from './lib/ui.js';
import './lib/logo-vectorizer.css';

type Props = { lang: 'ar' | 'en'; onAddLogos: (files: File[], meta: { colors: string[]; background: string | null }) => void };

export function LogoVectorizePanel({ lang, onAddLogos }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const app = useRef<ReturnType<typeof mount> | null>(null);
  const onAdd = useRef(onAddLogos);
  onAdd.current = onAddLogos;

  useEffect(() => {
    app.current = mount(host.current!, {
      lang,
      hostActionLabel: lang === 'ar' ? 'أضف إلى الهوية' : 'Add to brand kit',
      onUse: (p: UsePayload) => onAdd.current(
        p.variants.map(v => new File([v.svg], `${p.name}-${v.id}.svg`, { type: 'image/svg+xml' })),
        { colors: p.colors, background: p.background },
      ),
    });
    return () => app.current?.destroy();
  }, []);

  useEffect(() => { app.current?.setLang(lang); }, [lang]);
  return <div ref={host} />;
}
