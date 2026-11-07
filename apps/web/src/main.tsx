import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronDown,
  Search,
  Home,
  Inbox,
  Handshake,
  ShieldCheck,
  FolderOpen,
  Settings2,
  Workflow,
  Plus,
  RefreshCw,
  LogOut,
  Menu,
  X,
  Link2,
  Mail,
  CalendarDays,
  HardDrive,
  Slack,
  CheckCircle2,
  AlertCircle,
  Activity,
  Sparkles,
  ArrowDownToLine,
  Play,
  Square,
  Clock3,
  ChevronRight,
  LoaderCircle,
  UserRound,
} from "lucide-react";
import { Button, Card, Badge, Dialog } from "./components/ui";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./styles.css";
type View =
  | "home"
  | "inbox"
  | "deals"
  | "approvals"
  | "campaigns"
  | "agents"
  | "activity"
  | "profile";
type Row = Record<string, any>;
const views: View[] = [
  "home",
  "inbox",
  "deals",
  "approvals",
  "campaigns",
  "agents",
  "activity",
  "profile",
];
function currentView(): View {
  const requested = new URLSearchParams(location.search).get("view") as View;
  return views.includes(requested) ? requested : "home";
}
const nav = [
  { id: "home", name: "Home", icon: Home },
  { id: "inbox", name: "Inbox", icon: Inbox },
  { id: "deals", name: "Deals", icon: Handshake },
  { id: "approvals", name: "Approvals", icon: ShieldCheck },
  { id: "campaigns", name: "Campaigns", icon: FolderOpen },
] as const;
const label = (s: string) => s.replaceAll("_", " ").replaceAll(".", " · ");
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const short = (s: string) => s?.slice(0, 8) || "—";
const tone = (state: string) =>
  /completed|approved|succeeded/.test(state)
    ? "green"
    : /rejected|failed|error/.test(state)
      ? "red"
      : /pending|awaiting/.test(state)
        ? "amber"
        : "purple";
function Mark({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 28 : 34}
      height={small ? 28 : 34}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <g fill="#8860bd">
        <path d="M20 3C11 3 4 10 4 19c8 0 15-7 16-16Z" />
        <path d="M37 20C37 11 30 4 21 4c0 8 7 15 16 16Z" />
        <path d="M20 37c9 0 16-7 16-16-8 0-15 7-16 16Z" />
        <path d="M3 20c0 9 7 16 16 16 0-8-7-15-16-16Z" />
      </g>
    </svg>
  );
}
function ChromeStar() {
  return (
    <svg className="hero-star" viewBox="0 0 280 240" aria-hidden="true">
      <defs>
        <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#c2b4db" />
          <stop offset=".3" stopColor="#fafff9" />
          <stop offset=".48" stopColor="#8e9c8c" />
          <stop offset=".55" stopColor="#ffffff" />
          <stop offset=".82" stopColor="#c0cbb5" />
          <stop offset="1" stopColor="#817691" />
        </linearGradient>
      </defs>
      <path
        d="M153 16c-7 82-13 92-107 105 94 9 100 15 107 99 11-84 18-90 102-99-84-13-91-23-102-105Z"
        fill="url(#metal)"
        stroke="#d5d6d2"
        strokeWidth="2"
      />
      <path
        d="M225 2c-4 30-7 34-42 39 35 5 38 8 42 39 5-31 8-34 39-39-31-5-34-9-39-39Z"
        fill="url(#metal)"
        stroke="#dee0d9"
      />
    </svg>
  );
}
function Empty({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: any;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function App() {
  const [view, setView] = useState<View>(currentView);
  const loadGeneration = useRef(0);
  const channelGeneration = useRef(0);
  const activeUser = useRef<string | null>(null);
  const [dataOwner, setDataOwner] = useState<string | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [configFailed, setConfigFailed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [rowsScope, setRowsScope] = useState("");
  const [loadError, setLoadError] = useState("");
  const [realtime, setRealtime] = useState("Not connected");
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignError, setCampaignError] = useState("");
  const [config, setConfig] = useState<Row | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [overviewData, setOverview] = useState<Row | null>(null);
  const [profileData, setProfile] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [activityData, setActivities] = useState<Row[]>([]);
  const [callData, setCalls] = useState<Row[]>([]);
  const [pagination, setPagination] = useState({
    hasMore: false,
    nextOffset: 50,
  });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    new URLSearchParams(location.search).get("connection_error") || "",
  );
  const [selected, setSelected] = useState<Row | null>(null);
  const [login, setLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState(false);
  const [smallScreen, setSmallScreen] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const navigationRef = useRef<HTMLElement>(null);
  const [channels, setChannels] = useState<Row[]>([]);
  const [channelCursor, setChannelCursor] = useState("");
  const [campaignTasks, setCampaignTasks] = useState<Row[]>([]);
  const [campaignEvents, setCampaignEvents] = useState<Row[]>([]);
  const [filter, setFilter] = useState("all");
  const [showCalls, setShowCalls] = useState(false);
  const missingSetup = config
    ? [
        { key: "database", label: "Workspace database" },
        { key: "authentication", label: "Sign-in" },
        { key: "creator", label: "Workspace owner" },
        { key: "encryption", label: "Secure credential storage" },
      ].filter((item) => !config.configuration?.[item.key])
    : [];
  const workspaceConfigured = !!config && missingSetup.length === 0;
  const ownsData = !!session && dataOwner === session.user.id;
  const overview = ownsData ? overviewData : null;
  const profile = ownsData ? profileData : null;
  const activities = ownsData ? activityData : [];
  const calls = ownsData ? callData : [];
  const api = useCallback(
    async (path: string, body?: unknown) => {
      const response = await fetch("/api" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(session
            ? { Authorization: "Bearer " + session.access_token }
            : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error || `Request failed (${response.status})`);
      if (!data) throw new Error("The server returned an unreadable response.");
      return data;
    },
    [session],
  );
  useEffect(() => {
    let live = true;
    let cancel = () => {};
    setConfigFailed(false);
    fetch("/api/config")
      .then((r) => {
        if (!r.ok) throw new Error("Configuration request failed");
        return r.json();
      })
      .then((data) => {
        if (!live) return;
        setConfig(data);
        if (data.supabaseUrl && data.supabaseKey) {
          const c = createClient(data.supabaseUrl, data.supabaseKey, {
            auth: { flowType: "pkce" },
          });
          setClient(c);
          c.auth.getSession().then(({ data, error: authError }) => {
            if (!live) return;
            if (authError) setError(authError.message);
            activeUser.current = data.session?.user.id || null;
            setSession(data.session);
            setAuthReady(true);
          });
          const { data: subscription } = c.auth.onAuthStateChange((_e, s) => {
            if (live) {
              activeUser.current = s?.user.id || null;
              setSession(s);
              setAuthReady(true);
            }
          });
          cancel = () => subscription.subscription.unsubscribe();
        } else setAuthReady(true);
      })
      .catch(() => {
        if (!live) return;
        setConfigFailed(true);
        setError("The server is unavailable. Start the API and try again.");
      });
    return () => {
      live = false;
      cancel();
    };
  }, [configAttempt]);
  useEffect(() => {
    loadGeneration.current += 1;
    channelGeneration.current += 1;
    setDataOwner(null);
    setOverview(null);
    setProfile(null);
    setRows([]);
    setRowsScope("");
    setActivities([]);
    setCalls([]);
    setSelected(null);
    setChannels([]);
    setChannelCursor("");
    setLoadError("");
    setPassword("");
    setRealtime("Not connected");
  }, [session?.user.id]);
  useEffect(() => {
    const pop = () => {
      setView(currentView());
      setSearch("");
      setFilter("all");
      setSelected(null);
      setMobile(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const query = matchMedia("(max-width: 760px)");
    const update = () => {
      setSmallScreen(query.matches);
      if (!query.matches) setMobile(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobile || !smallScreen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    navigationRef.current
      ?.querySelector<HTMLButtonElement>(".nav-close")
      ?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", close);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mobile, smallScreen]);
  const resource =
    view === "home"
      ? "inbox"
      : view === "agents"
        ? "runs"
        : view === "profile"
          ? null
          : view === "activity"
            ? showCalls
              ? "calls"
              : "activity"
            : view;
  const scope = `${session?.user.id || "signed-out"}:${resource || "profile"}`;
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (
      !session ||
      activeUser.current !== session.user.id ||
      !workspaceConfigured
    ) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const [summary, p, feed, log, list] = await Promise.all([
        api("/overview"),
        api("/profile"),
        api("/activity"),
        api("/calls"),
        resource ? api("/" + resource) : Promise.resolve(null),
      ]);
      if (
        generation !== loadGeneration.current ||
        activeUser.current !== session.user.id
      )
        return;
      setDataOwner(session.user.id);
      setOverview(summary);
      setProfile(p);
      setActivities(feed.rows);
      setCalls(log.rows);
      setRows(list?.rows || []);
      setRowsScope(scope);
      setPagination({
        hasMore: !!list?.hasMore,
        nextOffset: list?.nextOffset || 50,
      });
    } catch (e) {
      if (generation === loadGeneration.current)
        setLoadError((e as Error).message);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [session, api, resource, scope, workspaceConfigured]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!client || !session || !workspaceConfigured) return;
    let live = true;
    const channel = client
      .channel("creator-activity-" + session.user.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_events",
          filter: "user_id=eq." + session.user.id,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tool_calls",
          filter: "user_id=eq." + session.user.id,
        },
        () => void load(),
      )
      .subscribe((status) => {
        if (!live) return;
        setRealtime(
          status === "SUBSCRIBED"
            ? "Live feed"
            : status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT" ||
                status === "CLOSED"
              ? "Live feed offline"
              : "Connecting feed",
        );
      });
    return () => {
      live = false;
      void client.removeChannel(channel);
    };
  }, [client, session, load, workspaceConfigured]);
  const refreshChannels = useCallback(
    async (cursor = "") => {
      const generation = ++channelGeneration.current;
      setChannelsLoading(true);
      setChannelError("");
      try {
        const data = await api(
          "/profile/slack/channels" +
            (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
        );
        if (generation !== channelGeneration.current) return;
        setChannels((old) =>
          cursor
            ? [
                ...old,
                ...data.channels.filter(
                  (c: Row) => !old.some((x) => x.id === c.id),
                ),
              ]
            : data.channels,
        );
        setChannelCursor(data.nextCursor);
      } catch (e) {
        if (generation === channelGeneration.current)
          setChannelError((e as Error).message);
      } finally {
        if (generation === channelGeneration.current) setChannelsLoading(false);
      }
    },
    [api],
  );
  useEffect(() => {
    if (view === "profile" && profile?.slack) void refreshChannels();
    else if (!profile?.slack) {
      setChannels([]);
      setChannelCursor("");
    }
  }, [view, profile?.slack?.workspace_id, refreshChannels]);
  useEffect(() => {
    let live = true;
    setCampaignTasks([]);
    setCampaignEvents([]);
    setCampaignError("");
    setCampaignLoading(!!(selected?.drive_folder_id && session));
    if (selected?.drive_folder_id && session)
      api("/campaigns/" + selected.id + "/tasks")
        .then((x) => {
          if (!live) return;
          setCampaignTasks(x.tasks);
          setCampaignEvents(x.events);
        })
        .catch((e) => {
          if (live) setCampaignError(e.message);
        })
        .finally(() => {
          if (live) setCampaignLoading(false);
        });
    return () => {
      live = false;
    };
  }, [selected?.id, selected?.drive_folder_id, session, api]);
  const navigate = (v: View) => {
    setView(v);
    setMobile(false);
    setSearch("");
    setFilter("all");
    setSelected(null);
    if (currentView() !== v) history.pushState(null, "", "?view=" + v);
  };
  async function action(path: string, body: unknown = {}) {
    if (!workspaceConfigured) {
      navigate("profile");
      return;
    }
    if (!session) {
      setLogin(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api(path, body);
      if (data.url) {
        location.assign(data.url);
        return;
      }
      await load();
      return data;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signIn(google = false) {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const result = google
        ? await client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: location.origin + "/?view=profile" },
          })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!google) setLogin(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.auth.signOut();
      if (result.error) throw result.error;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!resource || loading) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError("");
    try {
      const data = await api(
        "/" + resource + "?offset=" + pagination.nextOffset,
      );
      if (generation !== loadGeneration.current) return;
      setRows((old) => [
        ...old,
        ...data.rows.filter((r: Row) => !old.some((x) => x.id === r.id)),
      ]);
      setPagination({ hasMore: data.hasMore, nextOffset: data.nextOffset });
    } catch (e) {
      if (generation === loadGeneration.current)
        setLoadError((e as Error).message);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }
  const stats = overview?.stats;
  const scopedRows = rowsScope === scope ? rows : [];
  const visible = scopedRows.filter(
    (r) =>
      (filter === "all" || r.status === filter || r.state === filter) &&
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
  );
  const runtime = profile?.runtime || config?.runtime;
  const userName =
    session?.user.user_metadata?.full_name?.split(" ")[0] || "creator";
  function exportCalls() {
    const blob = new Blob([JSON.stringify(calls, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "creavate-tool-calls.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  function DataTable() {
    if (!authReady)
      return (
        <div className="empty" role="status">
          <LoaderCircle className="spin" />
          <p>Restoring your session…</p>
        </div>
      );
    if (!session)
      return (
        <Empty
          title="Your workspace starts here"
          description="Sign in to connect your apps and manage real sponsorship inquiries."
          action={
            <Button onClick={() => setLogin(true)}>
              Sign in <ArrowRight size={15} />
            </Button>
          }
        />
      );
    if (
      (!authReady || loading || rowsScope !== scope) &&
      !scopedRows.length &&
      !loadError
    )
      return (
        <div className="empty">
          <LoaderCircle className="spin" />
          <p>Loading your workspace…</p>
        </div>
      );
    if (loadError && !scopedRows.length)
      return (
        <Empty
          icon={AlertCircle}
          title="Couldn’t load your records"
          description={loadError}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      );
    if (!visible.length)
      return (
        <Empty
          icon={view === "approvals" ? ShieldCheck : Inbox}
          title={
            search
              ? "No matching records"
              : view === "approvals"
                ? "Nothing waiting on you"
                : view === "campaigns"
                  ? "Room for your next collaboration"
                  : "A fresh start"
          }
          description={
            search
              ? "Try another search in the loaded records."
              : view === "inbox" || view === "home"
                ? "Connect Google in your profile, then check your inbox. Sponsorship classification happens through Brand Agent."
                : "Your real workflow activity will appear here as campaigns progress."
          }
          action={
            <Button variant="outline" onClick={() => navigate("profile")}>
              Manage connections <ArrowUpRight size={14} />
            </Button>
          }
        />
      );
    return (
      <>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  {view === "deals"
                    ? "Brand / deal"
                    : view === "campaigns"
                      ? "Campaign"
                      : view === "approvals"
                        ? "Approval request"
                        : view === "agents"
                          ? "Agent run"
                          : view === "activity"
                            ? "Activity"
                            : "Inquiry"}
                </th>
                <th>Status</th>
                <th>
                  {view === "deals"
                    ? "Fee"
                    : view === "agents"
                      ? "Model"
                      : "Received / created"}
                </th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(r);
                  }}
                >
                  <td>
                    <span className="row-title">
                      {r.subject ||
                        r.brand ||
                        (r.tool && label(r.tool)) ||
                        (r.kind && label(r.kind)) ||
                        (r.agent && label(r.agent)) ||
                        (r.deal_id && "Deal " + short(r.deal_id)) ||
                        "Approval " + short(r.id)}
                    </span>
                    <span className="row-sub">
                      {r.sender ||
                        r.summary ||
                        r.actor ||
                        (r.task_id && "Task " + short(r.task_id)) ||
                        (r.drive_folder_id &&
                          "Drive folder " + short(r.drive_folder_id)) ||
                        (r.manifest_hash &&
                          "Manifest " + short(r.manifest_hash))}
                    </span>
                  </td>
                  <td>
                    <Badge tone={tone(r.status || r.state || r.kind || "")}>
                      {label(
                        r.status ||
                          r.state ||
                          r.kind ||
                          (r.tool
                            ? r.error
                              ? "failed"
                              : r.duration === null
                                ? "running"
                                : "succeeded"
                            : "organized"),
                      )}
                    </Badge>
                  </td>
                  <td className="muted">
                    {view === "deals"
                      ? r.fee === null
                        ? "Not specified"
                        : `${r.currency || ""} ${Number(r.fee).toLocaleString()}`
                      : view === "agents"
                        ? r.model
                        : date(r.received_at || r.created_at || r.started_at)}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="View record"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(r);
                      }}
                    >
                      <ArrowUpRight size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination.hasMore && (
          <div className="load-more">
            <Button variant="outline" disabled={loading} onClick={more}>
              Load more
            </Button>
          </div>
        )}
      </>
    );
  }
  function renderProfile() {
    return (
      <div className="profile-grid">
        <Card className="profile-heading">
          <div className="avatar avatar-large">
            <UserRound size={26} />
          </div>
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2>
              {session?.user.user_metadata?.full_name || "Creator profile"}
            </h2>
            <p>{session?.user.email || "Sign in to connect your tools"}</p>
          </div>
          {session && (
            <Button
              variant="outline"
              className="profile-signout"
              disabled={busy}
              onClick={() => void signOut()}
            >
              <LogOut size={15} /> Sign out
            </Button>
          )}
        </Card>
        {!session && (
          <Card className="profile-signin">
            <div>
              <h3>Make this workspace yours</h3>
              <p>Sign in before authorizing Google or Slack.</p>
            </div>
            <Button
              disabled={!authReady || !workspaceConfigured}
              onClick={() => setLogin(true)}
            >
              Sign in <ArrowRight size={15} />
            </Button>
          </Card>
        )}
        {missingSetup.length > 0 && (
          <Card className="workspace-setup" role="status">
            <div className="workspace-setup-title">
              <Settings2 size={20} />
              <div>
                <h3>Before you connect</h3>
                <p>These workspace settings need administrator setup.</p>
              </div>
            </div>
            <ul>
              {missingSetup.map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <Badge tone="amber">Not configured</Badge>
                </li>
              ))}
            </ul>
            <a
              href="https://github.com/vishal88736/creavate/blob/main/docs/CONNECTIONS.md"
              target="_blank"
              rel="noreferrer"
            >
              Open setup guide <ArrowUpRight size={14} />
            </a>
          </Card>
        )}
        <div className="section-title">
          <div>
            <h2>Connections</h2>
            <p>Your tools. One creative workspace.</p>
          </div>
          <Badge tone="purple">Creator controlled</Badge>
        </div>
        <Card className="connection">
          <div className="connection-top">
            <div className="app-logo google-mark">G</div>
            <div>
              <h3>Google Workspace</h3>
              <p>Gmail, Drive & Calendar</p>
            </div>
            <Badge tone={profile?.google ? "green" : "neutral"}>
              {profile?.google
                ? "Authorized"
                : session && !profile
                  ? "Checking connection"
                  : "Not connected"}
            </Badge>
          </div>
          <p className="connection-copy">
            Read sponsorship inquiries, keep briefs together, and organize
            approved campaign deadlines.
          </p>
          <div className="connection-tools">
            <span>
              <Mail size={14} /> Gmail
            </span>
            <span>
              <HardDrive size={14} /> Drive
            </span>
            <span>
              <CalendarDays size={14} /> Calendar
            </span>
          </div>
          {profile?.google && (
            <div className="connection-account">
              <CheckCircle2 size={15} />
              {profile.google.google_email}
            </div>
          )}
          <div className="connection-footer">
            <small>
              {profile?.google
                ? "Campaign writes always require your approval."
                : config?.googleOAuthConfigured
                  ? "Choose the Google account you want to use."
                  : "Google authorization needs administrator setup."}
            </small>
            <Button
              variant={profile?.google ? "outline" : "default"}
              disabled={
                busy ||
                !authReady ||
                !workspaceConfigured ||
                (!!session && !profile) ||
                (!profile?.google && !config?.googleOAuthConfigured)
              }
              onClick={() =>
                void action(
                  profile?.google
                    ? "/profile/google/disconnect"
                    : "/profile/google/connect",
                )
              }
            >
              {profile?.google ? "Disconnect" : "Connect Google"}
              <ArrowUpRight size={14} />
            </Button>
          </div>
        </Card>
        <Card className="connection">
          <div className="connection-top">
            <div className="app-logo slack-mark">
              <Slack size={25} />
            </div>
            <div>
              <h3>Slack</h3>
              <p>Conversation & approvals</p>
            </div>
            <Badge tone={profile?.slack ? "green" : "neutral"}>
              {profile?.slack
                ? "Authorized"
                : session && !profile
                  ? "Checking connection"
                  : "Not connected"}
            </Badge>
          </div>
          <p className="connection-copy">
            Meet your agents in a shared room. Review the deal and exact actions
            before anything is created.
          </p>
          {profile?.slack ? (
            <>
              <div className="connection-account">
                <CheckCircle2 size={15} />
                Workspace {profile.slack.workspace_id} · user{" "}
                {profile.slack.slack_user_id}
              </div>
              <label className="field-label">
                Campaign channel
                <select
                  value={profile.slack.channel_id || ""}
                  disabled={busy || channelsLoading}
                  onChange={(e) =>
                    void action("/profile/slack/channel", {
                      channel_id: e.target.value,
                    })
                  }
                >
                  <option value="" disabled>
                    {channelsLoading
                      ? "Loading channels…"
                      : "Choose a channel with the app invited"}
                  </option>
                  {profile.slack.channel_id &&
                    !channels.some(
                      (c) => c.id === profile.slack.channel_id,
                    ) && (
                      <option value={profile.slack.channel_id}>
                        Selected channel · {profile.slack.channel_id}
                      </option>
                    )}
                  {channels.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.joined}>
                      #{c.name}
                      {!c.joined ? " — invite app first" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {channelError && (
                <p className="inline-error" role="alert">
                  {channelError}
                </p>
              )}
              <div className="button-row channel-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || channelsLoading}
                  onClick={() => void refreshChannels()}
                >
                  <RefreshCw
                    size={13}
                    className={channelsLoading ? "spin" : ""}
                  />
                  Refresh channels
                </Button>
                {channelCursor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || channelsLoading}
                    onClick={() => void refreshChannels(channelCursor)}
                  >
                    Load more channels
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="connection-tools">
              <span>
                <ShieldCheck size={14} /> Verified creator approval
              </span>
            </div>
          )}
          <div className="connection-footer">
            <small>
              {config?.slackOAuthConfigured
                ? "Authorize Slack, then select your campaign channel."
                : "Slack authorization needs administrator setup."}
            </small>
            <Button
              disabled={
                busy ||
                !authReady ||
                !workspaceConfigured ||
                (!!session && !profile) ||
                (!profile?.slack && !config?.slackOAuthConfigured)
              }
              variant={profile?.slack ? "outline" : "default"}
              onClick={() =>
                void action(
                  profile?.slack
                    ? "/profile/slack/disconnect"
                    : "/profile/slack/connect",
                )
              }
            >
              {profile?.slack ? "Disconnect" : "Connect Slack"}
              <ArrowUpRight size={14} />
            </Button>
          </div>
        </Card>
        <Card className="connection switch-connection">
          <div className="connection-top">
            <div className="app-logo purple">
              <Workflow size={24} />
            </div>
            <div>
              <h3>Your agent room</h3>
              <p>Powered by Switch + OpenCode</p>
            </div>
            <Badge
              tone={
                runtime?.ready ? "green" : profile?.room ? "purple" : "neutral"
              }
            >
              {runtime?.ready
                ? "Live"
                : profile?.room
                  ? "Room configured"
                  : "Not connected"}
            </Badge>
          </div>
          <p className="connection-copy">
            Three teammates with distinct responsibilities, working together
            through the same room.
          </p>
          <p className="model-disclosure">
            Model: {runtime?.model || "Not configured"}. Inquiry and brief
            content is sent to this model for analysis when agents run.
          </p>
          <div className="agent-mini-list">
            {["Talent Manager", "Brand Agent", "Campaign Agent"].map(
              (name, i) => (
                <span key={name}>
                  <div className={"agent-dot agent-dot-" + i} />
                  {name}
                </span>
              ),
            )}
          </div>
          {runtime?.error && (
            <div className="inline-error">{runtime.error}</div>
          )}
          <div className="connection-footer">
            <small>
              {profile?.room
                ? "Room " + short(profile.room.switch_id)
                : "Connect Slack and choose a channel first."}
            </small>
            <div className="button-row">
              <Button
                variant="outline"
                disabled={busy || !profile?.slack?.channel_id}
                onClick={() => void action("/setup/switch")}
              >
                <Link2 size={14} /> Connect room
              </Button>
              <Button
                disabled={busy || !profile?.room}
                onClick={() =>
                  void action(
                    runtime?.running ? "/runtime/stop" : "/runtime/start",
                  )
                }
              >
                {runtime?.running ? <Square size={14} /> : <Play size={14} />}{" "}
                {runtime?.running ? "Stop agents" : "Start agents"}
              </Button>
            </div>
          </div>
        </Card>
        <Card className="privacy-card">
          <ShieldCheck size={20} />
          <div>
            <h3>You stay in control</h3>
            <p>
              Google tokens are encrypted. Agents have separate tool
              permissions. Every campaign write checks your recorded approval
              and appears in the activity log.
            </p>
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div className="page-background">
      <div className={"app-shell " + (mobile ? "nav-open" : "")}>
        {mobile && smallScreen && (
          <button
            className="nav-backdrop"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setMobile(false)}
          />
        )}
        <aside
          className="sidebar"
          id="workspace-navigation"
          ref={navigationRef}
          aria-label="Workspace navigation"
          inert={smallScreen && !mobile}
          onKeyDown={(e) => {
            if (!mobile || !smallScreen || e.key !== "Tab") return;
            const controls = [
              ...(navigationRef.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled), a[href]",
              ) || []),
            ];
            const first = controls[0],
              last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }}
        >
          <button
            className="nav-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={19} />
          </button>
          <a
            className="brand"
            href="?view=home"
            onClick={(e) => {
              e.preventDefault();
              navigate("home");
            }}
          >
            <Mark />
            <span>
              creavate<span className="brand-period">.</span>
            </span>
          </a>
          <div className="workspace-pill">
            <div className="workspace-monogram">C</div>
            <div>
              <strong>Creator workspace</strong>
              <span>Your creative operations</span>
            </div>
            <ChevronDown size={14} />
          </div>
          <span className="nav-label">WORKSPACE</span>
          <nav>
            {nav.map((n) => (
              <button
                className={"nav-item " + (view === n.id ? "active" : "")}
                key={n.id}
                aria-current={view === n.id ? "page" : undefined}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={18} />
                <span>{n.name}</span>
                {n.id === "approvals" && stats?.pending > 0 && (
                  <span className="nav-count">{stats.pending}</span>
                )}
              </button>
            ))}
          </nav>
          <span className="nav-label nav-label-second">YOUR TEAM</span>
          <button
            className={"nav-item " + (view === "agents" ? "active" : "")}
            aria-current={view === "agents" ? "page" : undefined}
            onClick={() => navigate("agents")}
          >
            <Workflow size={18} />
            <span>AI agents</span>
            {runtime?.ready && <span className="live-dot" />}
          </button>
          <button
            className={"nav-item " + (view === "activity" ? "active" : "")}
            aria-current={view === "activity" ? "page" : undefined}
            onClick={() => navigate("activity")}
          >
            <Activity size={18} />
            <span>Activity</span>
          </button>
          <div className="sidebar-bottom">
            <Card className="side-note">
              <div className="side-note-icon">
                <Sparkles size={16} />
              </div>
              <strong>More space to create.</strong>
              <p>Let the coordination take care of itself.</p>
              <button onClick={() => navigate("profile")}>
                Connect your tools <ArrowUpRight size={13} />
              </button>
            </Card>
            <button
              className={"nav-item " + (view === "profile" ? "active" : "")}
              aria-current={view === "profile" ? "page" : undefined}
              onClick={() => navigate("profile")}
            >
              <Settings2 size={18} />
              <span>Profile & connections</span>
            </button>
            <button
              className="account-button"
              onClick={() => (session ? navigate("profile") : setLogin(true))}
            >
              <div className="avatar">
                {session?.user.email?.slice(0, 1).toUpperCase() || (
                  <UserRound size={17} />
                )}
              </div>
              <div>
                <strong>
                  {userName === "creator" ? "Your profile" : userName}
                </strong>
                <span>
                  {session ? "Personal workspace" : "Sign in to get started"}
                </span>
              </div>
              <ChevronDown size={14} />
            </button>
          </div>
        </aside>
        <div className="main-shell" inert={smallScreen && mobile}>
          <header className="topbar">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X size={19} /> : <Menu size={19} />}
            </Button>
            <div className="breadcrumb">
              <span>Workspace</span>
              <span className="slash">/</span>
              <strong>
                {view === "profile"
                  ? "Profile"
                  : label(view)[0].toUpperCase() + label(view).slice(1)}
              </strong>
            </div>
            <div className="top-actions">
              <span className="workspace-status">
                <span className={runtime?.ready ? "live-dot" : "quiet-dot"} />
                {runtime?.ready
                  ? "Agents connected"
                  : "Your creative workspace"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("profile")}
              >
                <Plus size={14} /> Connect app
              </Button>
              <button
                className="avatar avatar-button"
                aria-label="Open profile"
                onClick={() => (session ? navigate("profile") : setLogin(true))}
              >
                {session?.user.email?.slice(0, 1).toUpperCase() || (
                  <UserRound size={17} />
                )}
              </button>
            </div>
          </header>
          <main>
            {config && !workspaceConfigured && view !== "profile" && (
              <div className="setup-banner" role="status">
                <Settings2 size={19} />
                <div>
                  <strong>Workspace setup is incomplete</strong>
                  <p>
                    Sign-in and app connections will be available after
                    administrator setup.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("profile")}
                >
                  View setup <ArrowRight size={14} />
                </Button>
              </div>
            )}
            {(error || loadError) && (
              <div className="alert alert-error" role="alert">
                <AlertCircle size={17} />
                <span>{error || loadError}</span>
                <button
                  aria-label="Dismiss error"
                  onClick={() => {
                    setError("");
                    setLoadError("");
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {!config && configFailed ? (
              <Empty
                icon={AlertCircle}
                title="Couldn’t open your workspace"
                description="Check that the API is running, then try again."
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setError("");
                      setConfigAttempt((x) => x + 1);
                    }}
                  >
                    Try again
                  </Button>
                }
              />
            ) : !config ? (
              <div className="empty">
                <LoaderCircle className="spin" />
                <p>Opening your workspace…</p>
              </div>
            ) : view === "profile" ? (
              renderProfile()
            ) : (
              <div className="dashboard-grid">
                <div className="primary-content">
                  {view === "home" ? (
                    <>
                      <section className="hero">
                        <div className="hero-copy">
                          <p className="welcome">
                            {session
                              ? "Welcome back, " + userName
                              : "A little less busy. A lot more creative."}
                            <span> ✦</span>
                          </p>
                          <h1>
                            Create more.
                            <br />
                            <span>Coordinate less.</span>
                          </h1>
                          <p className="hero-subtitle">
                            Your brand deals, connected.
                            <br />
                            Your next idea, uninterrupted.
                          </p>
                        </div>
                        <ChromeStar />
                        <button
                          className="hero-command"
                          onClick={() => navigate("profile")}
                        >
                          <span className="command-spark">✧</span>
                          <span>
                            {profile?.google
                              ? "Your tools are connected. Make room for your next collaboration."
                              : "Connect your tools. Give your creativity more room."}
                          </span>
                          <span className="command-arrow">
                            <ArrowRight size={17} />
                          </span>
                        </button>
                      </section>
                      <div className="section-title">
                        <h2>Make yourself at home</h2>
                        <span className="muted small">
                          A connected workflow starts here
                        </span>
                      </div>
                      <div className="start-grid">
                        {[
                          {
                            icon: Mail,
                            title: "Your inbox",
                            copy: "A home for incoming deals",
                            view: "inbox",
                            color: "gold",
                          },
                          {
                            icon: ShieldCheck,
                            title: "Your decisions",
                            copy: "Review what happens next",
                            view: "approvals",
                            color: "orange",
                          },
                          {
                            icon: Link2,
                            title: "Your connections",
                            copy: "Bring your tools together",
                            view: "profile",
                            color: "pink",
                          },
                        ].map((x) => (
                          <button
                            className="start-card"
                            onClick={() => navigate(x.view as View)}
                            key={x.title}
                          >
                            <span className={"start-icon " + x.color}>
                              <x.icon size={18} />
                            </span>
                            <span>
                              <strong>{x.title}</strong>
                              <small>{x.copy}</small>
                            </span>
                            <ArrowUpRight size={15} />
                          </button>
                        ))}
                      </div>
                      <div className="section-title">
                        <h2>Your workspace, at a glance</h2>
                        <span className="muted small">
                          Live from your activity
                        </span>
                      </div>
                      <div className="metric-grid">
                        {[
                          {
                            name: "Inquiries",
                            value: stats?.inquiries,
                            icon: Inbox,
                            copy: "Messages in your workspace",
                            color: "purple",
                          },
                          {
                            name: "Deals analyzed",
                            value: stats?.deals,
                            icon: Handshake,
                            copy: "Clarity on every opportunity",
                            color: "pink",
                          },
                          {
                            name: "Awaiting you",
                            value: stats?.pending,
                            icon: ShieldCheck,
                            copy: "Decisions in your hands",
                            color: "gold",
                          },
                          {
                            name: "Campaigns",
                            value: stats?.campaigns,
                            icon: FolderOpen,
                            copy: "Organized and ready to go",
                            color: "green",
                          },
                        ].map((m) => (
                          <Card className="metric-card" key={m.name}>
                            <div className="metric-heading">
                              <strong>{m.name}</strong>
                              <m.icon size={15} />
                            </div>
                            <div className="metric-number">
                              {m.value === undefined ? "—" : m.value}
                              <span className={"metric-accent " + m.color} />
                            </div>
                            <p>{m.copy}</p>
                            <div className={"metric-line " + m.color} />
                          </Card>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="page-title">
                      <span className="eyebrow">YOUR WORKSPACE</span>
                      <h1>
                        {view === "agents"
                          ? "A team that works with you"
                          : view === "activity"
                            ? "Every step, in the open"
                            : view === "inbox"
                              ? "Good things start here."
                              : view === "deals"
                                ? "Know every opportunity."
                                : view === "approvals"
                                  ? "Your call. Always."
                                  : "Everything in its place."}
                      </h1>
                      <p>
                        {view === "agents"
                          ? "Separate identities. Clear responsibilities. Shared context."
                          : view === "approvals"
                            ? "Review the exact actions. Approve when you’re ready."
                            : view === "campaigns"
                              ? "Campaign folders, deadlines and tasks created from approved plans."
                              : "Real records from your connected creator workflow."}
                      </p>
                    </div>
                  )}
                  {view === "agents" ? (
                    <div className="agents-grid">
                      {[
                        {
                          name: "Talent Manager",
                          role: "talent-manager",
                          icon: Workflow,
                          copy: "Keeps the conversation moving. Coordinates your agents and asks for your approval.",
                        },
                        {
                          name: "Brand Agent",
                          role: "brand-agent",
                          icon: Handshake,
                          copy: "Reads inquiries and briefs. Extracts the terms, spots risks and assesses fit.",
                        },
                        {
                          name: "Campaign Agent",
                          role: "campaign-agent",
                          icon: FolderOpen,
                          copy: "Organizes approved campaigns. Every write checks the exact approval first.",
                        },
                      ].map((a, i) => (
                        <Card className="agent-card" key={a.role}>
                          <span
                            className={
                              "start-icon " + ["purple", "gold", "green"][i]
                            }
                          >
                            <a.icon size={22} />
                          </span>
                          <h3>{a.name}</h3>
                          <p>{a.copy}</p>
                          <Badge tone={runtime?.ready ? "green" : "neutral"}>
                            {runtime?.ready ? "Connected" : "Not running"}
                          </Badge>
                          <small>
                            {profile?.agents?.find(
                              (x: Row) => x.role === a.role,
                            )?.name || "Identity not configured"}
                          </small>
                        </Card>
                      ))}
                    </div>
                  ) : null}
                  <section className="records-section">
                    <div className="section-title records-heading">
                      <div>
                        <h2>
                          {view === "home"
                            ? "Recent inquiries"
                            : view === "agents"
                              ? "Agent runs"
                              : view === "activity"
                                ? "Workflow activity"
                                : view[0].toUpperCase() + view.slice(1)}
                        </h2>
                        <p>
                          {view === "home"
                            ? "The beginning of your next collaboration."
                            : view === "agents"
                              ? "Actual executions, model status and failures."
                              : "Search, review and follow the real records."}
                        </p>
                      </div>
                      <div className="button-row">
                        {view === "activity" && (
                          <>
                            <Button
                              variant={showCalls ? "outline" : "default"}
                              size="sm"
                              onClick={() => setShowCalls(false)}
                            >
                              Events
                            </Button>
                            <Button
                              variant={showCalls ? "default" : "outline"}
                              size="sm"
                              onClick={() => setShowCalls(true)}
                            >
                              Tool calls
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!calls.length}
                              onClick={exportCalls}
                            >
                              <ArrowDownToLine size={13} /> Export
                            </Button>
                          </>
                        )}
                        {view === "home" || view === "inbox" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void action("/inbox/check")}
                          >
                            <RefreshCw
                              size={14}
                              className={busy ? "spin" : ""}
                            />{" "}
                            Check inbox
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => void load()}
                          >
                            <RefreshCw size={14} /> Refresh
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="table-toolbar">
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          aria-label="Search loaded records"
                          placeholder="Search loaded records…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      {view === "approvals" && (
                        <select
                          aria-label="Approval status"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All decisions</option>
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      )}
                    </div>
                    <Card className="table-card">
                      <DataTable />
                    </Card>
                  </section>
                  {view === "campaigns" && visible.length > 0 && (
                    <p className="muted small">
                      Open a campaign to see its real Drive folder and Calendar
                      event IDs.
                    </p>
                  )}
                </div>
                <aside className="activity-rail">
                  <Card className="overview-card">
                    <div className="section-title">
                      <h2>Overview</h2>
                      <button
                        aria-label="Open activity"
                        className="round-button"
                        onClick={() => navigate("activity")}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <p className="muted">
                      A little perspective on your workflow.
                    </p>
                    <div className="chart-tabs">
                      <button className="selected">Activity</button>
                      <button onClick={() => navigate("approvals")}>
                        Approvals
                      </button>
                      <button onClick={() => navigate("agents")}>Agents</button>
                    </div>
                    <div className="chart-heading">
                      <span>Last 7 days</span>
                      <small>Workspace events</small>
                    </div>
                    <div
                      className="activity-chart"
                      aria-label="Activity events by day"
                    >
                      {overview?.daily?.map((d: Row) => {
                        const max = Math.max(
                          1,
                          ...overview.daily.map((x: Row) => x.count),
                        );
                        return (
                          <div className="chart-column" key={d.day}>
                            <span className="chart-value">{d.count || ""}</span>
                            <div className="chart-track">
                              <div
                                className="chart-bar"
                                style={{
                                  height:
                                    Math.max(
                                      d.count ? 5 : 0,
                                      (Number(d.count) / max) * 100,
                                    ) + "%",
                                }}
                              />
                            </div>
                            <small>
                              {new Date(d.day + "T12:00:00").toLocaleDateString(
                                undefined,
                                { weekday: "narrow" },
                              )}
                            </small>
                          </div>
                        );
                      }) || (
                        <div className="chart-empty">
                          <Activity size={22} />
                          <span>Your activity will take shape here.</span>
                        </div>
                      )}
                    </div>
                    <div className="rail-divider" />
                    <div className="section-title">
                      <h2>Activity log</h2>
                      <Badge
                        tone={
                          session && realtime === "Live feed"
                            ? "purple"
                            : "neutral"
                        }
                      >
                        {session ? realtime : "Not connected"}
                      </Badge>
                    </div>
                    <div className="activity-list">
                      {activities.length ? (
                        activities.slice(0, 8).map((a) => (
                          <button
                            className="activity-item"
                            key={a.id}
                            onClick={() => setSelected(a)}
                          >
                            <div className={"activity-icon " + tone(a.kind)}>
                              {/approval/.test(a.kind) ? (
                                <ShieldCheck size={17} />
                              ) : (
                                <Activity size={17} />
                              )}
                            </div>
                            <span>
                              <small className={"text-" + tone(a.kind)}>
                                {label(a.kind)}
                              </small>
                              <strong>{label(a.actor)}</strong>
                            </span>
                            <time>
                              {new Date(a.created_at).toLocaleTimeString(
                                undefined,
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </time>
                          </button>
                        ))
                      ) : (
                        <div className="rail-empty">
                          <Clock3 size={21} />
                          <p>Quiet for now.</p>
                          <small>
                            Your workflow’s real activity will appear here.
                          </small>
                        </div>
                      )}
                    </div>
                  </Card>
                  <Card className="approval-promise">
                    <div className="promise-heading">
                      <ShieldCheck size={18} />
                      <strong>Made for your peace of mind</strong>
                    </div>
                    <p>
                      Your agents coordinate.
                      <br />
                      You make the final call.
                    </p>
                    <button onClick={() => navigate("approvals")}>
                      Review approvals <ArrowRight size={14} />
                    </button>
                  </Card>
                </aside>
              </div>
            )}
          </main>
          <footer>
            <span>
              creavate.{" "}
              <span className="footer-tagline">
                Create more. Coordinate less.
              </span>
            </span>
            <button onClick={() => navigate("profile")}>
              <span className={runtime?.ready ? "live-dot" : "quiet-dot"} />
              {runtime?.ready
                ? "Connected workspace"
                : "Manage your connections"}
              <ChevronRight size={12} />
            </button>
          </footer>
        </div>
      </div>
      <Dialog
        open={login}
        onOpenChange={setLogin}
        title="Welcome to Creavate"
        description="Sign in to your creator workspace."
      >
        {workspaceConfigured && config?.supabaseUrl && config?.supabaseKey ? (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <Button
              type="button"
              disabled={busy}
              onClick={() => void signIn(true)}
            >
              <span className="google-mark small-logo">G</span> Continue with
              Google
            </Button>
            <div className="or-divider">or use your workspace account</div>
            <label className="field-label">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field-label">
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !email || !password}>
              Sign in <ArrowRight size={15} />
            </Button>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </form>
        ) : (
          <Empty
            icon={Settings2}
            title="Sign-in setup is incomplete"
            description="Workspace sign-in needs administrator setup before you can authorize your accounts."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setLogin(false);
                  navigate("profile");
                }}
              >
                View setup <ArrowRight size={15} />
              </Button>
            }
          />
        )}
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
        title={
          selected?.subject ||
          selected?.brand ||
          (selected?.kind && label(selected.kind)) ||
          "Record details"
        }
        description={selected?.id ? "Record " + selected.id : undefined}
      >
        {selected && (
          <div className="record-detail">
            {selected.status && (
              <Badge tone={tone(selected.status)}>
                {label(selected.status)}
              </Badge>
            )}
            {selected.summary && (
              <p className="detail-summary">{selected.summary}</p>
            )}
            {selected.red_flags?.length > 0 && (
              <div className="risk-list">
                <h3>Things to review</h3>
                {selected.red_flags.map((r: string) => (
                  <p key={r}>
                    <AlertCircle size={14} />
                    {r}
                  </p>
                ))}
              </div>
            )}
            {selected.body && <div className="email-body">{selected.body}</div>}
            {selected.requested_action && (
              <>
                <h3>Exact proposed actions</h3>
                <ol className="action-list">
                  {selected.requested_action.actions.map((a: Row) => (
                    <li key={a.id}>
                      <strong>{a.title}</strong>
                      <small>{a.tool}</small>
                      <details>
                        <summary>Proposed parameters</summary>
                        <pre>{JSON.stringify(a.args, null, 2)}</pre>
                      </details>
                    </li>
                  ))}
                </ol>
                <p className="muted small">
                  Expires {date(selected.expires_at)} · Manifest{" "}
                  {short(selected.manifest_hash)}
                </p>
                {selected.status === "pending" && (
                  <div className="decision-footer">
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        new Date(selected.expires_at).getTime() < Date.now()
                      }
                      onClick={async () => {
                        const result = await action(
                          "/approvals/" + selected.id + "/decide",
                          { decision: "rejected" },
                        );
                        if (result)
                          setSelected((old) =>
                            old?.id === result.id ? { ...old, ...result } : old,
                          );
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      disabled={
                        busy ||
                        new Date(selected.expires_at).getTime() < Date.now()
                      }
                      onClick={async () => {
                        const result = await action(
                          "/approvals/" + selected.id + "/decide",
                          { decision: "approved" },
                        );
                        if (result)
                          setSelected((old) =>
                            old?.id === result.id ? { ...old, ...result } : old,
                          );
                      }}
                    >
                      <Check size={15} /> Approve these actions
                    </Button>
                  </div>
                )}
              </>
            )}
            {selected.drive_folder_id && (
              <a
                className="file-link"
                href={
                  "https://drive.google.com/drive/folders/" +
                  encodeURIComponent(selected.drive_folder_id)
                }
                target="_blank"
                rel="noreferrer"
              >
                <FolderOpen size={17} /> Open campaign folder{" "}
                <ArrowUpRight size={14} />
              </a>
            )}
            {selected.calendar_event_ids && (
              <p className="muted">
                Calendar event IDs:{" "}
                {selected.calendar_event_ids.join(", ") || "None recorded"}
              </p>
            )}
            {campaignLoading && (
              <p role="status">Loading campaign deadlines and tasks…</p>
            )}
            {campaignError && (
              <p className="inline-error" role="alert">
                {campaignError}
              </p>
            )}
            {campaignEvents.length > 0 && (
              <div className="deadline-list">
                <h3>Calendar deadlines</h3>
                {campaignEvents.map((e) => (
                  <a
                    className="file-link"
                    key={e.id}
                    href={e.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <CalendarDays size={17} />
                    <span>
                      {e.summary}
                      <small>{date(e.start.dateTime || e.start.date)}</small>
                    </span>
                    <ArrowUpRight size={14} />
                  </a>
                ))}
              </div>
            )}
            {campaignTasks.length > 0 && (
              <div className="campaign-task-list">
                <h3>Campaign tasks</h3>
                {campaignTasks.map((t) => (
                  <div className="campaign-task" key={t.id}>
                    <button
                      aria-label={
                        (t.completed ? "Reopen " : "Complete ") + t.title
                      }
                      className={
                        t.completed ? "task-check checked" : "task-check"
                      }
                      disabled={busy}
                      aria-pressed={!!t.completed}
                      onClick={async () => {
                        const result = await action(
                          "/campaign-tasks/" + t.id + "/complete",
                          { completed: !t.completed },
                        );
                        if (result)
                          setCampaignTasks((old) =>
                            old.map((x) => (x.id === t.id ? result : x)),
                          );
                      }}
                    >
                      {t.completed && <Check size={13} />}
                    </button>
                    <span>
                      {t.title}
                      <small>
                        {t.due_at ? date(t.due_at) : "No deadline recorded"}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <details className="raw-record">
              <summary>Audit record</summary>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </details>
          </div>
        )}
      </Dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
