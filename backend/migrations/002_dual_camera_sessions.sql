alter table capture_sessions
  add column if not exists expected_device_count integer not null default 1 check (expected_device_count between 1 and 4),
  add column if not exists join_token text,
  add column if not exists status text not null default 'pairing'
    check (status in ('pairing', 'ready', 'recording', 'uploading', 'uploaded', 'processing', 'completed', 'failed', 'expired')),
  add column if not exists sync_metadata jsonb,
  add column if not exists expires_at timestamptz not null default (now() + interval '24 hours'),
  add column if not exists updated_at timestamptz not null default now();

update capture_sessions
set join_token = upper(substr(replace(id, 'cs_', ''), 1, 8))
where join_token is null;

alter table capture_sessions
  alter column join_token set not null;

alter table capture_devices
  add column if not exists project_id text references projects(id) on delete cascade,
  add column if not exists take_id text references takes(id) on delete cascade,
  add column if not exists app_version text,
  add column if not exists metadata jsonb,
  add column if not exists paired_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update capture_devices d
set project_id = s.project_id,
    take_id = s.take_id
from capture_sessions s
where d.capture_session_id = s.id
  and (d.project_id is null or d.take_id is null);

alter table upload_sessions
  add column if not exists capture_session_id text references capture_sessions(id) on delete set null,
  add column if not exists device_id text;

alter table capture_videos
  add column if not exists capture_session_id text references capture_sessions(id) on delete set null,
  add column if not exists device_id text,
  add column if not exists sync_metadata jsonb;

create unique index if not exists idx_capture_sessions_join_token
  on capture_sessions(join_token);

create unique index if not exists idx_capture_devices_session_device
  on capture_devices(capture_session_id, device_id);

create unique index if not exists idx_capture_devices_session_index
  on capture_devices(capture_session_id, device_index);

create index if not exists idx_capture_sessions_take
  on capture_sessions(take_id);

create index if not exists idx_capture_videos_session
  on capture_videos(capture_session_id);
