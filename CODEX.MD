# Project Instructions

## UI Architecture

- The custom Maven Test Explorer webview is the project's only target user interface.
- Implement all new UI behavior, rendering, icons, states, interactions, and presentation in the custom webview and its model.
- Do not add features or UI fixes to the native VS Code Testing tree.
- Treat the existing native implementation only as a temporary reference and source of functionality to migrate into the custom webview.
- When migrating functionality, reproduce it in the custom model and webview rather than extending the native implementation.
- The native Testing-tree implementation is scheduled for removal after its required functionality has been transferred to the custom view.
- Before editing UI-related code, identify whether the visible element belongs to the custom webview. Screenshots from Maven Test Explorer should be assumed to show the custom webview unless proven otherwise.
