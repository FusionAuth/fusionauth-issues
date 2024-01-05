---
name: Bug report 2
description: Create a bug report to help us improve FusionAuth
title: "[Bug]: "

body:
- type: markdown
  attributes:
    value: |
      Thanks for taking the time to fill out this bug report!
- type: textarea
  id: description
  attributes:
    label: Description
    description: What happened, and what did you expect to happen?
    placeholder: "Example: I clicked a button and it exploded."
  validations:
    required: true
- type: input
  id: version
  attributes:
    label: Version
    description: What version of FusionAuth are you using?
    placeholder: "Example: 1.42.0"
  validations:
    required: true
- type: input
  id: affects_versions
  attributes:
    label: Affects Versions
    description: What versions of FusionAuth will be affected by this bug? |
      If you do not know, just leave this blank and a FusionAuth engineer will figure it out.
    placeholder: "Example: >= 1.42.0, or 1.42.0 - 1.44.1"
  validations:
    required: false    
---
