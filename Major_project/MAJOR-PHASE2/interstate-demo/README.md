# Interstate Vehicle Transfer Demo

This folder contains a standalone demonstration of the inter-state vehicle transfer workflow.
It is intentionally isolated from the existing application so it does not modify or break the current project.

## Purpose

This demo shows how a vehicle transfer can work in a realistic government workflow:

1. Owner requests transfer from one state to another
2. System validates vehicle ownership and legal status
3. Vehicle passport is generated
4. Source RTO approves the exit
5. Destination RTO approves the entry
6. New registration number is assigned
7. Blockchain transaction record is created

## Run

```bash
node interstate-demo/demo-flow.js
```

## Demo scenario

- Source state: Karnataka (KA)
- Destination state: Tamil Nadu (TN)
- Owner: owner@biochain.com
- Source RTO: ka.rto@biochain.com
- Destination RTO: tn.rto@biochain.com

## Notes

This is a presentation-safe, non-invasive simulation designed to explain the idea clearly without affecting the working project files.
