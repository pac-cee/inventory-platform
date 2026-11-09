"use client";
import { useState } from "react";
import {
  Box,
  Map,
  Wallet,
  QrCode,
  Warehouse,
  HandHelping,
  ChartNoAxesCombined,
  Users,
  Settings,
  Route,
  X,
  LoaderCircle,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  canManageInventory,
  canUsePayments,
  isAdmin,
  roleLabel,
  type Capable,
} from "@/lib/roles";
import styles from "./workspace-tools.module.css";
import { VerletLogo } from "@/components/ui/verlet-logo";
export interface WorkspaceTab {
  id: string;
  name: string;
  path?: string;
}
export const MAP_TAB: WorkspaceTab = { id: "map", name: "Map" };
export function WorkspaceTools({
  profile,
  active,
  onChange,
  compact,
  onToggle,
}: {
  profile: Capable | null;
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  compact: boolean;
  onToggle: () => void;
}) {
  const manager = canManageInventory(profile);
  const groups = [
    {
      name: "Find & store",
      tabs: [
        { ...MAP_TAB, icon: Map },
        { id: "inventory", name: "Inventory", icon: Box },
        { id: "locations", name: "Locations", icon: Warehouse },
        { id: "directions", name: "Directions", icon: Route },
        { id: "scan", name: "Scan", icon: QrCode },
      ],
    },
    {
      name: "Operations",
      tabs: [
        ...(manager
          ? [
              {
                id: "borrowed",
                name: "Borrowed",
                path: "/equipment",
                icon: HandHelping,
              },
            ]
          : []),
        ...(canUsePayments(profile)
          ? [
              {
                id: "payments",
                name: "Payments",
                path: "/payments",
                icon: Wallet,
              },
            ]
          : []),
        ...(manager
          ? [
              {
                id: "reports",
                name: "Reports",
                path: "/reports",
                icon: ChartNoAxesCombined,
              },
            ]
          : []),
      ],
    },
    {
      name: "Workspace",
      tabs: [
        ...(isAdmin(profile)
          ? [{ id: "people", name: "People", path: "/users", icon: Users }]
          : []),
        { id: "settings", name: "Settings", path: "/settings", icon: Settings },
      ],
    },
  ];
  return (
    <nav
      className={styles.navigation}
      aria-label="Workspace sections"
      data-compact={compact}
    >
      <div className={styles.brandRow}>
        <button
          className={styles.brand}
          aria-label="Verlet overview"
          onClick={() => onChange(MAP_TAB)}
        >
          <VerletLogo />
          <span>Verlet</span>
        </button>
        <button
          className={styles.collapse}
          aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
          title={compact ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!compact}
          onClick={onToggle}
        >
          {compact ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className={styles.scope}>
        <span>{roleLabel(profile?.role)}</span>
        <strong>Inventory</strong>
      </div>
      <div className={styles.navScroll}>
        {groups
          .filter((g) => g.tabs.length)
          .map((group) => (
            <div className={styles.navGroup} key={group.name}>
              {group.tabs.map(({ icon: Icon, ...tab }) => (
                <button
                  key={tab.id}
                  aria-label={tab.name}
                  title={compact ? tab.name : undefined}
                  data-settings={tab.id === "settings"}
                  aria-pressed={
                    active.id === tab.id ||
                    (tab.id === "inventory" && active.id === "catalog") ||
                    (tab.id === "locations" && active.id === "location-editor")
                  }
                  className={styles.navButton}
                  onClick={() => onChange(tab)}
                >
                  <Icon size={17} />
                  <span>{tab.name}</span>
                </button>
              ))}
            </div>
          ))}
      </div>
    </nav>
  );
}
function ToolFrame({ tab }: { tab: WorkspaceTab }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div className={styles.loading} role="status">
          <LoaderCircle size={18} />
          <span>Opening {tab.name.toLowerCase()}…</span>
        </div>
      )}
      <iframe
        src={tab.path}
        title={`${tab.name} workspace`}
        className={styles.frame}
        data-loaded={loaded}
        onLoad={() => setLoaded(true)}
        allow="camera"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
      />
    </>
  );
}
export function WorkspacePanels({
  active,
  visited,
  content,
  onMap,
  onBack,
}: {
  active: WorkspaceTab;
  visited: WorkspaceTab[];
  content: React.ReactNode;
  onMap: () => void;
  onBack: () => void;
}) {
  const native = !active.path && active.id !== "map";
  return (
    <>
      {visited.map((tab) => (
        <section
          key={tab.id}
          aria-label={`${tab.name} panel`}
          aria-hidden={active.id !== tab.id}
          inert={active.id !== tab.id}
          data-active={active.id === tab.id}
          className={styles.surface}
        >
          <div className={styles.panelBar}>
            {["catalog", "location-editor"].includes(tab.id) && (
              <button onClick={onBack} aria-label="Back to list">
                <ArrowLeft size={16} />
              </button>
            )}
            <h2>{tab.name}</h2>
            <button onClick={onMap} aria-label="Close workspace panel">
              <X size={18} />
            </button>
          </div>
          <ToolFrame tab={tab} />
        </section>
      ))}
      <section
        aria-label={`${active.name} panel`}
        aria-hidden={!native}
        inert={!native}
        data-active={native}
        className={styles.surface}
      >
        <div className={styles.panelBar}>
          <h2>{active.name}</h2>
          <button onClick={onMap} aria-label="Close workspace panel">
            <X size={18} />
          </button>
        </div>
        <div className={styles.nativeBody}>{content}</div>
      </section>
    </>
  );
}
