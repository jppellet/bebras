# bebras

A tool to manage Bebras task in a Markdown format


# Installation

**Note:** If you don't want to use the command-line tools directly, you may be more interested by the [**`bebras-vscode`**](https://github.com/jppellet/bebras-vscode) VS Code extension, which provides a graphical front-end to the most used commands. The instructions below are valid to use the command-line tools.

  1. If you don't have it yet, download Node from <https://nodejs.org/en/download/>.
<!--      * On Windows, make sure to check the checkbox to install the additional compilation tools during the installation process -->
  2. Run `npm install -g bebras`
  3. Discover available commands by running `bebras --help` or `bebras <cmd> --help`


# Commands

Most commands have a recusive option to treat all tasks in a given folder in a row. To use it, replace the path to the task file with `-r path/to/folder` or `--recursive path/to/folder`.

## bebras find

Finds and queries Bebras tasks in a folder.

**Description:** Searches for all task files in a directory and allows filtering by language, age category, difficulty, or custom JMESPath queries. Can output task metadata in various formats.

**Typical usage:**
```bash
bebras find ./tasks -l eng
```

## bebras check

Validates a task file for correctness and consistency.

**Description:** Runs various checks on a Bebras task file to ensure it follows the required format and contains no errors or warnings.

**Typical usage:**
```bash
bebras check path/to/SampleTask.task.md
```

## bebras prettify

Auto-formats a task file according to style conventions.

**Description:** Reformats Bebras task files to follow consistent styling rules: proper indentation, aligned tables, normalized spacing, and correct section formatting.

**Typical usage:**
```bash
bebras prettify path/to/SampleTask.task.md
```

## bebras convert

Converts a task file into various output formats.

**Description:** Transforms a Bebras task file from Markdown into other formats such as HTML, PDF, LaTeX, JSON, or Cuttle format.

**Typical usage:**
```bash
bebras convert html path/to/SampleTask.task.md
```

**Supported formats:** html, pdf, latex, json, cuttle

**Common options:**
- `-r, --recursive`: Batch prettify all task files in a folder
- `-F, --filter <pattern>`: Only process files matching a glob pattern (with `-r`)
- `--no-tables`: Skip table alignment
- `--no-sections`: Skip section spacing normalization

## bebras server

Communicates with a Cuttle server for task management.

**Description:** Manages tasks on a Cuttle server instance, including creating new tasks, uploading/downloading content, and checking image references.

**Typical usage:**
```bash
bebras server <subcommand>
```

**Subcommands:**
- `new`: Creates a new task on the Cuttle server
- `upload`: Uploads tasks to the Cuttle server  
- `download`: Downloads tasks from the Cuttle server
- `insert`: Inserts sections into existing server HTML files
- `checkimages`: Reports missing images on the Cuttle server

**Common options:**
- Credentials are managed securely via system keychain (or as a fallback in a configuration file)
