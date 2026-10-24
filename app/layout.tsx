import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Sans_3 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";

// Mentaljineer type: chrome + titles = Geist, data/code = Geist Mono,
// teaching prose = Source Sans 3 (kept for long reading). CMU Serif stays
// bundled (lh-cmu in globals.css) for the optional serif session names.
const ui = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

// Paints the saved theme before hydration (AppearanceProvider keeps it in
// sync afterwards), so a Light or Nocturne user never sees a dark flash.
const THEME_BOOT = `try{var t=localStorage.getItem("lh-theme");if(t==="light"||t==="nocturne"){var r=document.documentElement;r.dataset.theme=t;if(t==="light")r.classList.remove("dark")}}catch(e){}`;

export const metadata: Metadata = {
	title: "MentalTuition",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-theme="dark" className={`dark ${ui.variable} ${mono.variable} ${prose.variable}`} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
			</head>
			<body className="min-h-dvh antialiased">
			{/* The ground: one faint light from above, film grain over it. */}
			<div className="lh-ground" aria-hidden="true" />
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
							<AppShell>{children}</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
		</body>
		</html>
	);
}
