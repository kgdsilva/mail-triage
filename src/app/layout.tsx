import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

// Inter for reading, Jakarta for headings and figures, mono only where alignment
// carries meaning — filenames and entity codes. `display: swap` so a slow font fetch
// never blanks the screen.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

// Wider and stronger than Inter at the same size, which is the whole point: a title
// should not need to be twice the body size to read as a title.
const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Mail Triage',
  description: 'Mail triage and action tracking',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${jetbrainsMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
