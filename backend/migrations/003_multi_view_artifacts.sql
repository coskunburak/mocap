alter table export_files
  add column if not exists artifact_name text;

update export_files
set artifact_name = format
where artifact_name is null;

alter table export_files
  alter column artifact_name set not null;

alter table export_files
  drop constraint if exists export_files_job_id_format_key;

create unique index if not exists idx_export_files_job_artifact_name
  on export_files(job_id, artifact_name);
