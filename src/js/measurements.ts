import type { Hub } from '@sentry/core';
import { getCurrentHub, getMainCarrier } from '@sentry/core';
import type { Transaction } from '@sentry/tracing';
import type { CustomSamplingContext, Span, SpanContext, TransactionContext } from '@sentry/types';

import { ReactNativeTracing } from './tracing';

const SPAN_OP_DEFAULT = 'default';

/**
 * Adds React Native's extensions. Needs to be called after @sentry/tracing's extension methods are added
 */
export function _addTracingExtensions(): void {
  const carrier = getMainCarrier();
  if (carrier.__SENTRY__) {
    carrier.__SENTRY__.extensions = carrier.__SENTRY__.extensions || {};
    if (carrier.__SENTRY__.extensions.startTransaction) {
      const originalStartTransaction = carrier.__SENTRY__.extensions
        .startTransaction as StartTransactionFunction;

      /*
        Overwrites the transaction start and finish to start and finish stall tracking.
        Preferably instead of overwriting add a callback method for this in the Transaction itself.
      */
      const _startTransaction = _patchStartTransaction(
        originalStartTransaction
      );

      carrier.__SENTRY__.extensions.startTransaction = _startTransaction;
    }
  }
}

export type StartTransactionFunction = (
  this: Hub,
  transactionContext: TransactionContext,
  customSamplingContext?: CustomSamplingContext
) => Transaction;

/**
 * Overwrite the startTransaction extension method to start and end stall tracking.
 */
const _patchStartTransaction = (
  originalStartTransaction: StartTransactionFunction
): StartTransactionFunction => {
  /**
   * Method to overwrite with
   */
  function _startTransaction(
    this: Hub,
    transactionContext: TransactionContext,
    customSamplingContext?: CustomSamplingContext
  ): Transaction {
    // Native SDKs require op to be set - for JS Relay sets `default`
    if (!transactionContext.op) {
      transactionContext.op = SPAN_OP_DEFAULT;
    }

    const transaction: Transaction = originalStartTransaction.apply(this, [
      transactionContext,
      customSamplingContext,
    ]);
    const originalStartChild: Transaction['startChild'] = transaction.startChild.bind(transaction);
    transaction.startChild = (
      spanContext?: Pick<SpanContext, Exclude<keyof SpanContext, 'sampled' | 'traceId' | 'parentSpanId'>>,
    ): Span => {
      return originalStartChild({
        ...spanContext,
        // Native SDKs require op to be set
        op: spanContext?.op || SPAN_OP_DEFAULT,
      });
    };

    const reactNativeTracing = getCurrentHub().getIntegration(
      ReactNativeTracing
    );

    if (reactNativeTracing) {
      reactNativeTracing.onTransactionStart(transaction);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalFinish = transaction.finish;

      transaction.finish = (endTimestamp: number | undefined) => {
        if (reactNativeTracing) {
          reactNativeTracing.onTransactionFinish(transaction);
        }

        return originalFinish.apply(transaction, [endTimestamp]);
      };
    }

    return transaction;
  }

  return _startTransaction;
};
