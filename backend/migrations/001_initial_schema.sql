create table if not exists users (
  id text primary key,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists takes (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  status text not null default 'created'
    check (status in ('created', 'uploading', 'uploaded', 'processing', 'processed', 'failed')),
  capture_mode text not null default 'solo'
    check (capture_mode in ('solo', 'dual', 'pro_4_camera')),
  expected_video_count integer not null default 1 check (expected_video_count between 1 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists capture_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  take_id text references takes(id) on delete cascade,
  capture_mode text not null default 'solo',
  created_at timestamptz not null default now()
);

create table if not exists capture_devices (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  capture_session_id text references capture_sessions(id) on delete cascade,
  device_id text not null,
  device_role text not null,
  device_index integer not null check (device_index >= 0),
  platform text,
  created_at timestamptz not null default now()
);

create table if not exists upload_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  take_id text not null references takes(id) on delete cascade,
  device_index integer not null check (device_index >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'expired', 'failed')),
  video_storage_key text not null,
  metadata_storage_key text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (take_id, device_index, status) deferrable initially immediate
);

create table if not exists capture_videos (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  take_id text not null references takes(id) on delete cascade,
  upload_session_id text not null references upload_sessions(id) on delete cascade,
  device_index integer not null check (device_index >= 0),
  device_role text not null,
  video_storage_key text not null,
  metadata_storage_key text not null,
  status text not null default 'uploading'
    check (status in ('uploading', 'uploaded', 'failed')),
  file_size_bytes bigint,
  metadata_size_bytes bigint,
  capture_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (take_id, device_index)
);

create table if not exists processing_jobs (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  take_id text not null references takes(id) on delete cascade,
  state text not null default 'queued'
    check (
      state in (
        'queued',
        'ingesting',
        'extracting_frames',
        'detecting_pose',
        'solving_motion',
        'cleaning',
        'exporting',
        'succeeded',
        'failed',
        'canceled'
      )
    ),
  preset text not null,
  progress integer not null default 0 check (progress between 0 and 100),
  message text,
  error_code text,
  retry_of_job_id text references processing_jobs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists job_timeline_events (
  id text primary key,
  job_id text not null references processing_jobs(id) on delete cascade,
  state text not null,
  message text,
  metrics jsonb,
  created_at timestamptz not null default now()
);

create table if not exists export_files (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  take_id text not null references takes(id) on delete cascade,
  job_id text references processing_jobs(id) on delete set null,
  preset text not null,
  format text not null,
  storage_key text not null,
  file_size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (job_id, format)
);

create table if not exists audit_logs (
  id text primary key,
  user_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_user on projects(user_id);
create index if not exists idx_takes_user_project on takes(user_id, project_id);
create index if not exists idx_capture_videos_take on capture_videos(take_id);
create index if not exists idx_upload_sessions_take on upload_sessions(take_id);
create index if not exists idx_jobs_take on processing_jobs(take_id);
create index if not exists idx_exports_take on export_files(take_id);
