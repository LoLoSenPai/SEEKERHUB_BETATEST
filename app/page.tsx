import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight, Check, Download, Grid2X2, LockKeyhole, MessageSquare, Plus } from "lucide-react";
import { BrandIcon } from "@/src/components/brand/brand-icon";
import { BRAND_ICON_PATH } from "@/src/lib/brand";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";
import { getSession } from "@/src/lib/session";
import "./homepage.css";

function ProductPreview() {
  return <div className="home-preview" aria-label="Illustrative example of the builder workspace and tester release page">
    <div className="home-preview-label"><span>PRODUCT PREVIEW</span><span>ILLUSTRATIVE EXAMPLE</span></div>
    <div className="home-preview-stage">
      <div className="home-desktop" aria-hidden="true">
        <aside className="home-preview-sidebar"><div className="home-preview-brand"><BrandIcon size={20} /> SeekerHub</div><small>PUBLISHING WORKSPACE</small><div className="home-preview-nav active"><Grid2X2 size={15} /> My apps</div><div className="home-preview-nav"><MessageSquare size={15} /> Feedback</div><div className="home-preview-nav"><Plus size={15} /> New app</div></aside>
        <div className="home-preview-content"><div className="home-preview-crumb">Publishing workspace / My apps</div><div className="home-preview-top"><div><h3>My apps</h3><p>Manage your private beta releases.</p></div><span className="home-preview-button">+ New app</span></div><div className="home-preview-app"><div className="home-app-art"><span>F</span></div><div className="home-app-info"><small>ANDROID APP</small><strong>Fieldnotes</strong><span>Private beta workspace</span></div><span className="home-status">Active</span></div><div className="home-preview-row"><span>Latest release</span><strong>Version 1.2.0</strong><span>View release →</span></div><div className="home-preview-row"><span>Tester feedback</span><strong>Ready to review</strong><span>View feedback →</span></div></div>
      </div>
      <div className="home-phone" aria-hidden="true"><div className="home-phone-bar"><BrandIcon size={16} /> SeekerHub <span>•••</span></div><div className="home-phone-banner" /><div className="home-phone-body"><div className="home-phone-app"><div className="home-phone-icon">F</div><div><strong>Fieldnotes</strong><small>1.2.0 · Android</small></div></div><p>A little space for your big ideas.</p><div className="home-phone-download"><Download size={13} /> Download APK</div><small>Open the downloaded APK on Android.</small><div className="home-phone-feedback">After your test: leave feedback <span>＋</span></div></div></div>
    </div>
    <p className="home-preview-caption">One workspace for your release. A simple path for your testers.</p>
  </div>;
}

export default async function Home() {
  const session = await getSession();
  const primaryHref = session ? "/dashboard" : "/sign-in?returnTo=%2Fdashboard";
  const primaryLabel = session ? "Open dashboard" : "Get started";

  return <div className="home">
    <a className="home-skip" href="#home-content">Skip to content</a>
    <header className="home-header home-wrap"><Link href="/" className="home-logo"><BrandIcon size={32} />SeekerHub</Link><nav aria-label="Main navigation" className="home-nav"><a href="#how-it-works" className="home-nav-how">How it works</a><ThemeToggle /><Link className="home-header-link" href={session ? "/dashboard" : "/sign-in"}>{session ? "Open dashboard" : "Sign in"} <ArrowRight size={16} aria-hidden="true" /></Link></nav></header>
    <main id="home-content">
      <section className="home-hero home-wrap"><div className="home-hero-copy"><div className="home-eyebrow"><span /> PRIVATE ANDROID BETAS</div><h1>Good apps are<br /><em>built together.</em></h1><p>Share your Android build with the right people. Gather the feedback that makes your next release better.</p><div className="home-actions"><Link className="home-primary" href={primaryHref}>{primaryLabel} <ArrowRight size={18} aria-hidden="true" /></Link><a className="home-secondary" href="#how-it-works">How it works <ArrowDown size={16} aria-hidden="true" /></a></div><div className="home-hero-note"><LockKeyhole size={15} aria-hidden="true" /> Your beta, shared on your terms.</div></div><div className="home-hero-art" aria-hidden="true"><span>FROM FIRST BUILD<br />TO BETTER RELEASE.</span><div className="home-art-mark"><Image src={BRAND_ICON_PATH} alt="" fill sizes="(max-width: 980px) 100vw, 50vw" preload /></div><div className="home-art-bottom">BUILD <span>→</span> TEST <span>→</span> IMPROVE</div></div></section>
      <section className="home-product home-wrap" aria-labelledby="product-title"><div className="home-section-heading"><div><p className="home-kicker">01 / THE WORKSPACE</p><h2 id="product-title">Less back and forth.<br /><span>More moving forward.</span></h2></div><p>From uploading a build to hearing what testers think, keep your beta in one place.</p></div><ProductPreview /></section>
      <section className="home-workflow" id="how-it-works"><div className="home-wrap"><div className="home-workflow-intro"><p className="home-kicker">02 / HOW IT WORKS</p><h2>Make the next<br />version count<span>.</span></h2><p>A straightforward loop for builders and the people helping them test.</p></div><div className="home-steps"><article><span className="home-step-number">01</span><div><h3>Upload</h3><p>Add your Android build and release notes to your workspace.</p></div><ArrowRight aria-hidden="true" /></article><article><span className="home-step-number">02</span><div><h3>Share</h3><p>Invite your testers and give them a place to access the release.</p></div><ArrowRight aria-hidden="true" /></article><article><span className="home-step-number">03</span><div><h3>Improve</h3><p>Collect feedback, learn what matters, and make the next build better.</p></div><Check aria-hidden="true" /></article></div></div></section>
      <section className="home-access home-wrap"><div className="home-access-title"><p className="home-kicker">03 / BUILT FOR THE LOOP</p><h2>Private by design.<br /><span>Better with people.</span></h2></div><div className="home-access-list"><article><span><LockKeyhole size={21} aria-hidden="true" /></span><div><h3>Keep access intentional</h3><p>Share releases through invitations and set access requirements for your beta.</p></div></article><article><span><MessageSquare size={21} aria-hidden="true" /></span><div><h3>Give feedback a home</h3><p>Testers can share their experience alongside the release, so useful context stays close.</p></div></article></div></section>
      <section className="home-faq home-wrap"><div><p className="home-kicker">04 / FOR TESTERS</p><h2>Invited to test?<br /><span>Start here.</span></h2><p className="home-faq-intro">You don’t need to find an app in a public catalogue. Your builder will point you in the right direction.</p></div><div className="home-faq-list"><details><summary>How do I join a beta?<span>+</span></summary><p>Open the private invitation link shared by the builder and follow the steps to access their release.</p></details><details><summary>How do I install a build?<span>+</span></summary><p>Once you have access, download the APK on your Android device and open it. You may need to allow installs from your browser.</p></details><details><summary>How do I share feedback?<span>+</span></summary><p>Return to the release in SeekerHub after testing and use the feedback section to tell the builder about your experience.</p></details><details><summary>Do I need a Seeker device?<span>+</span></summary><p>Not always. Some builders may set specific access requirements for their beta; check the invitation or release for details.</p></details></div></section>
      <section className="home-final home-wrap"><div><p className="home-kicker">YOUR NEXT RELEASE STARTS HERE</p><h2>Build it. Share it.<br /><span>Make it better.</span></h2></div><Link className="home-final-button" href={primaryHref}>{primaryLabel} <ArrowRight size={20} aria-hidden="true" /></Link></section>
    </main>
    <footer className="home-footer home-wrap"><Link href="/" className="home-logo"><BrandIcon size={28} />SeekerHub</Link><p>Private Android betas, built together.</p><nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/abuse">Report abuse</Link></nav></footer>
  </div>;
}
