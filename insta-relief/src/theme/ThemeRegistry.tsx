import { useState } from "react";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const [emotionCache] = useState(() =>
    createCache({ key: "mui", prepend: true })
  );

  return <CacheProvider value={emotionCache}>{children}</CacheProvider>;
}