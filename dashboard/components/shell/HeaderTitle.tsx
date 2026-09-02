"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface HeaderTitleApi {
  title: string | null;
  setTitle: (t: string | null) => void;
}

const Ctx = createContext<HeaderTitleApi>({ title: null, setTitle: () => undefined });

export function HeaderTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const api = useMemo(() => ({ title, setTitle }), [title]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useHeaderTitle(): HeaderTitleApi {
  return useContext(Ctx);
}

/**
 * Render inside a page to replace the breadcrumb leaf (e.g. the property
 * address on the detail route). Clears itself on unmount.
 */
export function SetHeaderTitle({ title }: { title: string }) {
  const { setTitle } = useHeaderTitle();
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
  return null;
}
