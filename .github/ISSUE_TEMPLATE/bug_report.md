name: "🐛 Bug Report"
description: Report a bug or unexpected behaviour
labels: ["bug"]

body:
  - type: dropdown
    id: device-type
    attributes:
      label: Device type
      options:
        - Android phone
        - iPhone / iPad
        - Desktop browser (Chrome / Firefox / Safari)
        - Other
    validations:
      required: true

  - type: input
    id: ram
    attributes:
      label: Device RAM (approximate)
      placeholder: "e.g. 2 GB"
    validations:
      required: false

  - type: input
    id: st-version
    attributes:
      label: SillyTavern version
      placeholder: "e.g. 1.12.5"
    validations:
      required: true

  - type: input
    id: ext-version
    attributes:
      label: Performance Boost version
      placeholder: "e.g. 1.3.0"
    validations:
      required: true

  - type: textarea
    id: description
    attributes:
      label: What happened?
      description: Describe the bug clearly
    validations:
      required: true

  - type: textarea
    id: reproduce
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Open ST on mobile
        2. Load a long chat (100+ messages)
        3. Enable Virtual Scrolling
        4. …
    validations:
      required: true

  - type: textarea
    id: console
    attributes:
      label: Browser console errors (if any)
      render: text
    validations:
      required: false
