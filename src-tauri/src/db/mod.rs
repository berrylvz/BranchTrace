pub(crate) mod demo;
pub(crate) mod projects;
pub(crate) mod reminders;
mod repo;
mod schema;
pub(crate) mod settings;
mod support;
pub(crate) mod trash;
pub(crate) mod views;
mod worker;

#[cfg(test)]
mod tests;

pub use demo::{create_demo_database_file, DemoSeedSummary};
pub use support::clock_context;
pub use worker::DbHandle;
