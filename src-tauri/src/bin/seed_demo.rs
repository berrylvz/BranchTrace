use branchtrace_lib::create_demo_database_file;
use chrono::{Local, NaiveDate};
use std::path::PathBuf;
use std::process::ExitCode;

struct CliOptions {
    output: PathBuf,
    today: NaiveDate,
    force: bool,
}

fn print_usage() {
    println!(
        "Generate a showcase SQLite database for BranchTrace.\n\n\
         USAGE:\n  seed_demo [OPTIONS]\n\n\
         OPTIONS:\n  \
         -o, --output <PATH>       Output SQLite path (default: demo/branchtrace-demo.sqlite3)\n  \
         -t, --today <YYYY-MM-DD>  Anchor date for relative showcase data (default: local today)\n  \
         -f, --force               Overwrite the output file if it already exists\n  \
         -h, --help                Print this help message"
    );
}

fn parse_iso_date(raw: &str) -> Result<NaiveDate, String> {
    let parsed = NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| format!("Invalid --today value '{raw}' (expected YYYY-MM-DD)"))?;
    if parsed.format("%Y-%m-%d").to_string() != raw {
        return Err(format!(
            "Invalid --today value '{raw}' (expected YYYY-MM-DD)"
        ));
    }
    Ok(parsed)
}

fn parse_args() -> Result<Option<CliOptions>, String> {
    let mut output = PathBuf::from("demo/branchtrace-demo.sqlite3");
    let mut today = Local::now().date_naive();
    let mut force = false;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_usage();
                return Ok(None);
            }
            "-f" | "--force" => {
                force = true;
            }
            "-o" | "--output" => {
                let value = args
                    .next()
                    .ok_or_else(|| "Missing path after --output".to_string())?;
                if value.trim().is_empty() {
                    return Err("Output path cannot be empty".to_string());
                }
                output = PathBuf::from(value);
            }
            "-t" | "--today" => {
                let value = args
                    .next()
                    .ok_or_else(|| "Missing date after --today".to_string())?;
                today = parse_iso_date(&value)?;
            }
            other => {
                return Err(format!(
                    "Unknown argument: {other}\nRun with --help for usage."
                ));
            }
        }
    }

    Ok(Some(CliOptions {
        output,
        today,
        force,
    }))
}

fn main() -> ExitCode {
    let options = match parse_args() {
        Ok(Some(opts)) => opts,
        Ok(None) => return ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("Error: {message}");
            return ExitCode::FAILURE;
        }
    };

    match create_demo_database_file(&options.output, options.today, options.force) {
        Ok(summary) => {
            let resolved_path = std::fs::canonicalize(&options.output).unwrap_or(options.output);
            println!(
                "Created BranchTrace demo database: {}",
                resolved_path.display()
            );
            println!("  Anchor today : {}", summary.anchor_today);
            println!(
                "  Projects     : {} visible, {} in Trash ({} progress records)",
                summary.visible_project_count,
                summary.trashed_project_count,
                summary.progress_record_count
            );
            println!(
                "  Reminders    : {} visible, {} in Trash",
                summary.visible_reminder_count, summary.trashed_reminder_count
            );
            println!(
                "  Trash batches: {} project, {} reminder",
                summary.project_trash_entry_count, summary.reminder_trash_entry_count
            );
            println!(
                "\nLaunch desktop app without touching your personal database:\n  BRANCHTRACE_DB_PATH=\"{}\" pnpm tauri dev",
                resolved_path.display()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!(
                "Failed to generate demo database ({:?}): {}",
                error.code, error.message
            );
            ExitCode::FAILURE
        }
    }
}
