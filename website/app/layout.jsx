import '../src/index.css';
import 'highlight.js/styles/github.css';
import { Providers } from '../src/components/Providers';

export const metadata = {
  title: 'HLVM',
  description: 'HLVM documentation and downloads',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link id="favicon-light" rel="icon" type="image/png" href="/hlvm_dragon.png" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
