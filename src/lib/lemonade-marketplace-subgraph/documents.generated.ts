import gql from 'graphql-tag';

export const GetOrders = gql`
    query GetOrders($lastBlock_gt: BigInt = -1, $skip: Int!, $first: Int!) {
  orders(
    orderBy: lastBlock
    orderDirection: asc
    where: {lastBlock_gt: $lastBlock_gt}
    skip: $skip
    first: $first
  ) {
    id
    lastBlock
    createdAt
    orderContract
    orderId
    open
    maker
    currency
    price
    priceIsMinimum
    tokenContract
    tokenId
    taker
    paidAmount
  }
}
    `;