begin;
create extension if not exists pgcrypto;
create table if not exists public.users (
 id uuid primary key references auth.users(id) on delete cascade,email text not null,
 slack_user_id text,switch_sender_id text,identity_verified_at timestamptz,created_at timestamptz not null default now()
);
create table if not exists public.google_connections (
 user_id uuid primary key references public.users(id) on delete cascade,encrypted_tokens text not null,scopes text[] not null,
 google_email text not null,connection_id uuid not null default gen_random_uuid(),scan_page_token text,history_id text,watch_expires_at timestamptz,updated_at timestamptz not null default now()
);
create table if not exists public.emails (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id) on delete cascade,
 gmail_id text not null,thread_id text not null,sender text not null,subject text not null,body text not null,
 attachments jsonb not null default '[]',received_at timestamptz not null,status text not null default 'received',created_at timestamptz not null default now(),unique(user_id,gmail_id)
);
create table if not exists public.deals (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id) on delete cascade,email_id uuid not null references public.emails(id),
 brand text not null,contact jsonb not null,deliverables jsonb not null,fee numeric,currency text,dates jsonb not null,exclusivity text,usage_rights text,payment_terms text,red_flags text[] not null,fit_score integer not null check(fit_score between 0 and 100),summary text not null,analysis jsonb not null,status text not null default 'analyzed',brief_files jsonb not null default '[]',created_at timestamptz not null default now(),unique(user_id,email_id)
);
create table if not exists public.tasks (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id) on delete cascade,email_id uuid not null references public.emails(id),deal_id uuid references public.deals(id),
 state text not null default 'received' check(state in ('received','analyzing','awaiting_approval','approved','rejected','executing','completed','failed')),
 hop_count integer not null default 0 check(hop_count>=0),error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,email_id)
);
create table if not exists public.agent_runs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),task_id uuid not null references public.tasks(id),agent text not null,status text not null default 'running',tool_count integer not null default 0,model text not null,result jsonb,error text,started_at timestamptz not null default now(),finished_at timestamptz
);
create table if not exists public.approvals (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),task_id uuid not null references public.tasks(id),deal_id uuid not null references public.deals(id),
 requested_action jsonb not null,manifest_hash text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decided_by uuid references public.users(id),decided_at timestamptz,source text check(source in ('slack','dashboard')),verified_identity boolean not null default false,
 expires_at timestamptz not null,created_at timestamptz not null default now(),check(status='pending' or (decided_by=user_id and decided_at is not null and verified_identity))
);
create unique index if not exists approvals_one_pending on public.approvals(task_id) where status='pending';
create table if not exists public.approval_executions (
 approval_id uuid not null references public.approvals(id),action_id uuid not null,user_id uuid not null references public.users(id),
 state text not null check(state in ('claimed','succeeded','uncertain','failed')),result jsonb,error text,resource_id text,started_at timestamptz not null default now(),finished_at timestamptz,primary key(approval_id,action_id)
);
create table if not exists public.tool_calls (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),task_id uuid references public.tasks(id),agent text not null,tool text not null,args jsonb not null,result jsonb,error text,started_at timestamptz not null default now(),duration integer,approval_id uuid references public.approvals(id)
);
create table if not exists public.campaigns (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),deal_id uuid not null unique references public.deals(id),drive_folder_id text,calendar_event_ids text[] not null default '{}',created_at timestamptz not null default now()
);
create table if not exists public.campaign_tasks (
 id uuid primary key,user_id uuid not null references public.users(id),deal_id uuid not null references public.deals(id),title text not null,due_at timestamptz,completed boolean not null default false,approval_id uuid not null references public.approvals(id),created_at timestamptz not null default now()
);
create table if not exists public.activity_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),task_id uuid references public.tasks(id),actor text not null,kind text not null,payload jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.switch_agents (
 user_id uuid not null references public.users(id),role text not null,switch_id text not null,name text not null,created_at timestamptz not null default now(),primary key(user_id,role)
);
create table if not exists public.switch_rooms (
 user_id uuid primary key references public.users(id),switch_id text not null,platform text not null,channel_id text not null,created_at timestamptz not null default now()
);
create table if not exists public.handoffs (
 id uuid primary key,user_id uuid not null references public.users(id),task_id uuid not null references public.tasks(id),sender text not null,recipient text not null,kind text not null,summary text not null,payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','uncertain')),receipt jsonb,error text,created_at timestamptz not null default now(),unique(task_id,kind,recipient)
);
create table if not exists public.processed_events (
 agent text not null,message_id text not null,handoff_id uuid not null,user_id uuid not null references public.users(id),state text not null default 'processing',created_at timestamptz not null default now(),primary key(agent,message_id),unique(agent,handoff_id)
);
create table if not exists public.oauth_states (
 id text primary key,user_id uuid not null references public.users(id),provider text not null default 'google',verifier text not null,expires_at timestamptz not null,created_at timestamptz not null default now()
);
create table if not exists public.identity_challenges (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),code_hash text not null unique,expires_at timestamptz not null,consumed_at timestamptz,created_at timestamptz not null default now()
);
create index if not exists task_owner_state on public.tasks(user_id,state);
create index if not exists activity_owner_created on public.activity_events(user_id,created_at desc);
create index if not exists calls_owner_created on public.tool_calls(user_id,started_at desc);
create index if not exists email_owner_received on public.emails(user_id,received_at desc);
create table if not exists public.slack_connections (
 user_id uuid primary key references public.users(id),encrypted_tokens text not null,workspace_id text not null,slack_user_id text not null,channel_id text,bridge_id text,updated_at timestamptz not null default now()
);
create table if not exists public.switch_agent_credentials (
 user_id uuid not null references public.users(id),role text not null,encrypted_key text not null,primary key(user_id,role)
);
create table if not exists public.slack_decisions (
 workspace_id text not null,channel_id text not null,message_ts text not null,user_id uuid not null references public.users(id),approval_id uuid not null references public.approvals(id),primary key(workspace_id,channel_id,message_ts)
);
create table if not exists public.switch_connections (
 user_id uuid not null references public.users(id),role text not null,connection_id uuid not null default gen_random_uuid(),cursor text,primary key(user_id,role)
);
-- Browser clients have own-row reads only. Every mutation runs through authenticated server code.
do $$declare t text;begin
 foreach t in array array['users','emails','deals','tasks','agent_runs','approvals','tool_calls','campaigns','campaign_tasks','activity_events','switch_agents','switch_rooms'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy creator_read on public.%I for select to authenticated using (%s = auth.uid())',t,case when t='users' then 'id' else 'user_id' end);
 execute format('grant select on public.%I to authenticated',t);
 execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from anon,authenticated',t);
 end loop;
 foreach t in array array['switch_connections','slack_connections','switch_agent_credentials','slack_decisions','google_connections','approval_executions','handoffs','processed_events','oauth_states','identity_challenges'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
-- Explicitly prohibit browser writes even if project default grants were permissive.
-- Private tables above have all client grants revoked.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.activity_events,public.tool_calls;
 end if;
end $$;
commit;
