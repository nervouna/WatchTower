export default {
  fetch(): Response {
    return new Response("test worker");
  },
  queue(batch: MessageBatch): void {
    batch.ackAll();
  },
} satisfies ExportedHandler;
