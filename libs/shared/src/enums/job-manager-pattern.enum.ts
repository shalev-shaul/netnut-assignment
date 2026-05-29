/**
 * Message patterns for the Job Manager TCP microservice.
 *
 * Shared between the API (ClientProxy.send) and the Job Manager
 * (@MessagePattern) so both ends agree on the wire contract.
 *
 * String values are intentional: they are the literal payload sent over the
 * transport, so they must stay stable and human-readable in logs. (A numeric
 * enum would silently change the wire values to 0/1 and break on reordering.)
 */
export enum JobManagerPattern {
  CREATE_JOB = 'create_job',
  GET_JOB = 'get_job',
}
