import { AuthGate } from "../components/auth-gate";
import { LogoutButton } from "../components/logout-button";

import { ArrowUpRight, Bell, Bookmark, Brain, CalendarDays, ChevronDown, CircleHelp, FileText, Folder, LayoutDashboard, Plus, Search, Settings2, ShieldCheck, Sparkles, UploadCloud, Users, Workflow } from "lucide-react";

const sections = [
  { label: "Vue d'ensemble", icon: LayoutDashboard, active: true },
  { label: "Mes mémoires", icon: Brain }, { label: "Mes sources", icon: FileText },
  { label: "Personnes & projets", icon: Users }, { label: "Chronologie", icon: CalendarDays }
];
const suggestions = [
  { title: "Retrouver une décision", detail: "Ce que vous avez décidé et pourquoi", icon: Bookmark },
  { title: "Préparer un rendez-vous", detail: "Rassembler les informations utiles", icon: CalendarDays },
  { title: "Explorer une relation", detail: "Relier personnes, projets et idées", icon: Workflow }
];

export default function HomePage() {
  return <AuthGate><main className="shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark"><Brain size={19}/></span><span>MEMORA</span></a>
      <div className="workspace-switch"><span className="workspace-avatar">M</span><span><b>Mon espace</b><small>Espace personnel</small></span><ChevronDown size={15}/></div>
      <div className="nav-label">ESPACE</div>
      <nav className="navigation">{sections.map(({label,icon:Icon,active})=><a key={label} className={active?"nav-item active":"nav-item"} href="#"><Icon size={17}/><span>{label}</span>{label==="Mes mémoires"&&<small>0</small>}</a>)}</nav>
      <div className="nav-label second-label">ORGANISATION</div>
      <nav className="navigation"><a className="nav-item" href="#"><Folder size={17}/><span>Collections</span></a><a className="nav-item" href="#"><Sparkles size={17}/><span>Assistant mémoire</span><span className="soon">À venir</span></a></nav>
      <div className="sidebar-bottom">
        <div className="privacy-note"><ShieldCheck size={17}/><span><b>Vos données vous appartiennent</b><small>Capture sélective · Confidentialité</small></span></div>
        <a className="nav-item" href="#"><Settings2 size={17}/><span>Paramètres</span></a><a className="nav-item" href="#"><CircleHelp size={17}/><span>Aide & support</span></a>
        <div className="profile"><span className="profile-avatar">M</span><span><b>Mon compte</b><small>Configurer mon profil</small></span><ChevronDown size={15}/></div>
      </div>
    </aside>
    <section className="main-panel">
      <header className="topbar"><div className="breadcrumb">Mon espace <span>/</span> <b>Vue d'ensemble</b></div><div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={18}/></button><span className="avatar-small">M</span><LogoutButton /></div></header>
      <div className="content">
        <div className="welcome-row"><div><div className="eyebrow">VOTRE ESPACE PERSONNEL</div><h1>Bonjour, bienvenue dans <span>votre mémoire.</span></h1><p>Un endroit privé pour retrouver ce qui compte, quand vous en avez besoin.</p></div><button className="primary-button"><Plus size={17}/> Ajouter une information</button></div>
        <div className="search-panel"><div className="search-icon"><Search size={20}/></div><div className="search-copy"><b>Que souhaitez-vous retrouver ?</b><span>Recherchez une personne, une idée, une décision ou un souvenir…</span></div><kbd>⌘ K</kbd></div>
        <div className="stats-grid">
          <article className="stat-card"><div className="stat-head"><span>Mémoires enregistrées</span><span className="stat-icon lavender"><Brain size={17}/></span></div><strong>0</strong><small>Votre mémoire se construit avec vous</small></article>
          <article className="stat-card"><div className="stat-head"><span>Sources importées</span><span className="stat-icon blue"><FileText size={17}/></span></div><strong>0</strong><small>Documents, notes et captures</small></article>
          <article className="stat-card"><div className="stat-head"><span>Personnes & projets</span><span className="stat-icon green"><Users size={17}/></span></div><strong>0</strong><small>Les éléments de votre univers</small></article>
        </div>
        <div className="section-heading"><div><h2>Commencez simplement</h2><p>Choisissez ce que vous souhaitez confier à MEMORA.</p></div><span className="private-label"><ShieldCheck size={14}/> Vous gardez le contrôle</span></div>
        <div className="action-grid">
          <article className="action-card featured"><span className="action-icon"><UploadCloud size={20}/></span><div><h3>Importer un document</h3><p>PDF, Word, texte ou image. Vous choisissez ce qui entre dans votre mémoire.</p></div><button aria-label="Importer un document"><ArrowUpRight size={17}/></button></article>
          <article className="action-card"><span className="action-icon note"><Plus size={20}/></span><div><h3>Écrire une note</h3><p>Ajoutez une idée, une information ou un souvenir important.</p></div><button aria-label="Créer une note"><ArrowUpRight size={17}/></button></article>
        </div>
        <div className="section-heading suggestions-heading"><div><h2>Ce que MEMORA vous aidera à faire</h2><p>Une mémoire utile, contextualisée et vérifiable.</p></div></div>
        <div className="suggestion-grid">{suggestions.map(({title,detail,icon:Icon})=><article className="suggestion-card" key={title}><Icon size={18}/><div><b>{title}</b><small>{detail}</small></div><ArrowUpRight size={15}/></article>)}</div>
        <footer className="footer-note"><ShieldCheck size={15}/> Vos informations restent privées. Rien n'est capturé sans votre autorisation.</footer>
      </div>
    </section>
  </main></AuthGate>;
}
