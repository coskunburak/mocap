update processing_jobs
set state = 'solving_motion'
where state = 'detecting_pose';

alter table processing_jobs
  drop constraint if exists processing_jobs_state_check;

alter table processing_jobs
  add constraint processing_jobs_state_check
  check (
    state in (
      'queued',
      'ingesting',
      'extracting_frames',
      'solving_motion',
      'cleaning',
      'exporting',
      'succeeded',
      'failed',
      'canceled'
    )
  );
