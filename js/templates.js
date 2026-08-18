export const TEMPLATES = [
  {
    id: "flowchart",
    name: "Flowchart",
    description: "Map a process, decision, or workflow.",
    icon: "◇→◇",
    code: `flowchart LR
    brief([Creative brief]) --> review{Approved?}
    review -->|Yes| build[Build concept]
    review -->|Not yet| revise[Revise direction]
    revise --> review
    build --> launch([Launch])

    classDef accent fill:#ff765f,stroke:#ff765f,color:#21110e
    classDef calm fill:#17231f,stroke:#54d1a5,color:#e7fff6
    class brief,launch accent
    class build calm`,
  },
  {
    id: "sequence",
    name: "Sequence Diagram",
    description: "Show interactions between systems over time.",
    icon: "↕ ↕ ↕",
    code: `sequenceDiagram
    autonumber
    actor User
    participant App
    participant Storage as Local storage
    User->>App: Edit diagram
    App->>App: Render preview
    App->>Storage: Save snapshot
    Storage-->>App: Saved
    App-->>User: Ready to export`,
  },
  {
    id: "class",
    name: "Class Diagram",
    description: "Describe classes and their relationships.",
    icon: "▤—▤",
    code: `classDiagram
    class Project {
      +String name
      +Diagram[] files
      +save()
      +open()
    }
    class Diagram {
      +String title
      +String source
      +render()
      +export()
    }
    Project "1" *-- "many" Diagram`,
  },
  {
    id: "state",
    name: "State Diagram",
    description: "Model states and the events between them.",
    icon: "●→◎",
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Reviewing: Request review
    Reviewing --> Draft: Changes requested
    Reviewing --> Approved: Approve
    Approved --> Published: Publish
    Published --> Archived: Archive
    Archived --> [*]`,
  },
  {
    id: "er",
    name: "Entity Relationship",
    description: "Plan database entities and connections.",
    icon: "▣—◇",
    code: `erDiagram
    PROJECT ||--o{ DIAGRAM : contains
    DIAGRAM ||--o{ VERSION : tracks
    PROJECT {
      string id PK
      string name
    }
    DIAGRAM {
      string id PK
      string title
      text source
    }
    VERSION {
      string id PK
      datetime created_at
      text source
    }`,
  },
  {
    id: "gantt",
    name: "Gantt Chart",
    description: "Lay out milestones and a project schedule.",
    icon: "▰ ▰",
    code: `gantt
    title Product launch
    dateFormat YYYY-MM-DD
    axisFormat %b %d
    section Discover
    Research           :done, research, 2026-08-03, 5d
    Define scope       :done, scope, after research, 3d
    section Design
    Prototype          :active, proto, after scope, 6d
    Review             :review, after proto, 2d
    section Build
    Implementation     :build, after review, 8d
    Launch             :milestone, launch, after build, 0d`,
  },
  {
    id: "journey",
    name: "User Journey",
    description: "Capture a user experience from end to end.",
    icon: "⌁⌁→",
    code: `journey
    title Create and share a diagram
    section Create
      Open local project: 5: User
      Choose a template: 4: User
      Edit Mermaid code: 5: User
    section Refine
      Review live preview: 5: User
      Restore a version: 4: User
    section Share
      Export a PDF: 5: User
      Send to the team: 5: User`,
  },
  {
    id: "pie",
    name: "Pie Chart",
    description: "Compare proportions across a few categories.",
    icon: "◔",
    code: `pie showData
    title Time saved each week
    "Diagram setup" : 28
    "Review" : 22
    "Export" : 18
    "Documentation" : 32`,
  },
  {
    id: "requirement",
    name: "Requirement Diagram",
    description: "Connect system requirements and elements.",
    icon: "REQ",
    code: `requirementDiagram
    requirement local_storage {
      id: 1
      text: Projects stay on the user's device
      risk: low
      verifymethod: test
    }
    functionalRequirement export_quality {
      id: 2
      text: Export diagrams at high resolution
      risk: medium
      verifymethod: demonstration
    }
    element browser_app {
      type: software
      docref: index.html
    }
    browser_app - satisfies -> local_storage
    browser_app - satisfies -> export_quality`,
  },
  {
    id: "git",
    name: "Git Graph",
    description: "Visualize branches, commits, and merges.",
    icon: "●⌁●",
    code: `gitGraph
    commit id: "initial"
    branch feature/editor
    checkout feature/editor
    commit id: "live-preview"
    commit id: "local-files"
    checkout main
    merge feature/editor
    branch release
    commit id: "v1.0" tag: "1.0.0"`,
  },
  {
    id: "c4",
    name: "C4 Diagram",
    description: "Explain software architecture at a glance.",
    icon: "C4",
    code: `C4Context
    title System context for Mermaid Studio
    Person(user, "Diagram author", "Creates and shares diagrams")
    System(studio, "Mermaid Studio", "Browser-based diagram workspace")
    System_Ext(files, "Local file system", "Project and export files")
    Rel(user, studio, "Creates diagrams with")
    Rel(studio, files, "Reads and writes", "File System Access API")`,
  },
  {
    id: "mindmap",
    name: "Mind Map",
    description: "Organize a topic into a clear hierarchy.",
    icon: "⌘◇",
    code: `mindmap
  root((Mermaid Studio))
    Create
      Live preview
      Templates
      Syntax feedback
    Organize
      Local projects
      Folder access
      Version history
    Share
      PNG and JPEG
      SVG
      PDF
      Portable project`,
  },
  {
    id: "timeline",
    name: "Timeline",
    description: "Show events and milestones chronologically.",
    icon: "●—●—●",
    code: `timeline
    title Diagram project
    Discovery : Define goals : Collect examples
    Structure : Create project : Organize diagrams
    Design : Edit code : Review live preview
    Delivery : Export assets : Share project file`,
  },
];

export const DEFAULT_CODE = TEMPLATES[0].code;
