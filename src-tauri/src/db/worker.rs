use super::schema::initialize_connection;
use crate::models::{ApiError, ErrorCode};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use tokio::sync::{mpsc, oneshot};

type DbJob = Box<dyn FnOnce(&mut Connection) + Send + 'static>;

struct DbHandleInner {
    sender: Mutex<Option<mpsc::UnboundedSender<DbJob>>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

#[derive(Clone)]
pub struct DbHandle {
    inner: Arc<DbHandleInner>,
}

impl DbHandle {
    pub fn start(path: PathBuf) -> Result<Self, ApiError> {
        let (sender, mut receiver) = mpsc::unbounded_channel::<DbJob>();
        let (ready_sender, ready_receiver) = std_mpsc::sync_channel::<Result<(), ApiError>>(1);
        let worker = thread::Builder::new()
            .name("branchtrace-db".to_string())
            .spawn(move || match initialize_connection(&path) {
                Ok(mut connection) => {
                    let _ = ready_sender.send(Ok(()));
                    while let Some(job) = receiver.blocking_recv() {
                        job(&mut connection);
                    }
                }
                Err(error) => {
                    let _ = ready_sender.send(Err(error));
                }
            })
            .map_err(|error| {
                ApiError::new(
                    ErrorCode::DbError,
                    format!("Failed to start database worker thread: {error}"),
                )
            })?;

        match ready_receiver.recv() {
            Ok(Ok(())) => Ok(Self {
                inner: Arc::new(DbHandleInner {
                    sender: Mutex::new(Some(sender)),
                    worker: Mutex::new(Some(worker)),
                }),
            }),
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(error)
            }
            Err(error) => {
                let _ = worker.join();
                Err(ApiError::new(
                    ErrorCode::DbError,
                    format!("Database worker thread failed to initialize: {error}"),
                ))
            }
        }
    }

    pub async fn call<T, F>(&self, operation: F) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
    {
        let sender = {
            let guard = self
                .inner
                .sender
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard
                .clone()
                .ok_or_else(|| ApiError::new(ErrorCode::DbError, "Database is shutting down"))?
        };
        let (reply, receiver) = oneshot::channel();
        let job: DbJob = Box::new(move |connection| {
            let _ = reply.send(operation(connection));
        });
        sender
            .send(job)
            .map_err(|_| ApiError::new(ErrorCode::DbError, "Database worker thread has stopped"))?;
        receiver.await.map_err(|_| {
            ApiError::new(
                ErrorCode::DbError,
                "Database operation did not return a result",
            )
        })?
    }

    pub fn shutdown(&self) {
        {
            let mut guard = self
                .inner
                .sender
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.take();
        }
        let worker = {
            let mut guard = self
                .inner
                .worker
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.take()
        };
        if let Some(handle) = worker {
            let _ = handle.join();
        }
    }
}
