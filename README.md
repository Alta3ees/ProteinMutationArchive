# Protein Mutation Archive

Protein Mutation Archive is a browser-first scientific workspace for preserving protein sequence lineages and the evidence generated for every variant. It is designed for projects with many related mutations, repeated experiments, alternative branches, and decisions that must remain understandable months or years later.

The application is fully client-side. It has no Python server, PyRosetta dependency, account system, or mandatory cloud storage. Project data stays in the browser until the researcher exports a portable archive.

## Current rebuild

This branch begins the transition from Human-Guided Protein Design to Protein Mutation Archive.

Implemented:

- hierarchical mutation lineage navigation;
- inherited and newly introduced mutation counts;
- residue-level highlighting against the reference sequence;
- experiment, structure, analysis, literature, and note records;
- small embedded file attachments;
- browser persistence;
- portable versioned JSON import and export;
- reference-versus-variant sequence comparison;
- active, promising, paused, and rejected states;
- responsive scientific workspace interface;
- a built-in GB1 example archive.

## Run locally

```bash
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Production build

```bash
cd frontend
npm ci
npm run build
```

The static application is written to `frontend/dist` and can be hosted on GitHub Pages or any static host.

## Archive format

Exported files use the suffix `.pma.json` and contain a versioned project object:

```text
Project
└── Designs
    ├── sequence + parent relationship
    ├── scientific rationale + status
    └── Evidence
        ├── experiment / structure / analysis / literature / note
        ├── protocol and metrics
        └── portable attachments
```

The first schema version is `1.0`. Future migrations should preserve old archives rather than rewriting scientific history silently.

## Privacy and file limits

Data is stored in the browser's local storage. Attachments below 2 MB are embedded in exported archives; larger files are currently registered by filename only. IndexedDB-backed large-file storage is planned.

## License

See [LICENSE](LICENSE).
