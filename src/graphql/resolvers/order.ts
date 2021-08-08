import { Arg, Args, Field, ObjectType, Resolver, Info, InputType, Root, Query, Subscription } from 'type-graphql';
import { GraphQLResolveInfo } from 'graphql';

import { Currency, Order, OrderModel } from '../../app/models/order';
import { PaginatedResponse, PaginatedResponseArgs } from '../types/paginated-response';
import { Token } from '../../app/models/token';
import { WhereInput } from '../types/where-input';

import { getFieldTree, getFieldProjection } from '../utils/field';
import { getFilter, validate } from '../utils/where';
import { subscribe } from '../utils/subscription';

@ObjectType()
class OrdersResponse extends PaginatedResponse(Order) { }

@InputType()
class OrderCurrencyWhere extends WhereInput(Currency) { }

@InputType()
class OrderTokenWhere extends WhereInput(Token) { }

@InputType()
class OrderWhere extends WhereInput(Order) {
  @Field(() => OrderCurrencyWhere, { nullable: true })
  currency?: OrderCurrencyWhere;

  @Field(() => OrderTokenWhere, { nullable: true })
  token?: OrderTokenWhere;
}

const findOrders = async (
  { skip, limit, where }: PaginatedResponseArgs & { where?: OrderWhere | null },
  info: GraphQLResolveInfo,
) => {
  const fields = getFieldTree(info);
  const query = where ? getFilter({ ...where, token: undefined }) : {};

  const [items, total] = await Promise.all([
    fields.items && OrderModel.aggregate([
      { $match: query },
      { $skip: skip },
      { $limit: limit },
      ...fields.items.token ? [
        {
          $lookup: {
            from: 'tokens',
            let: { token: '$token' },
            pipeline: [{ $match: { $expr: { $eq: ['$id', '$$token'] }, ...where?.token && getFilter(where.token) } }],
            as: 'token',
          },
        },
        { $unwind: '$token' },
      ] : [],
      { $project: getFieldProjection(fields.items) },
    ]),
    fields.total && OrderModel.countDocuments(query),
  ]);

  return { items, total };
};

@Resolver()
class _OrdersQueryResolver {
  @Query(() => OrdersResponse)
  async orders(
    @Info() info: GraphQLResolveInfo,
    @Args() args: PaginatedResponseArgs,
    @Arg('where', () => OrderWhere, { nullable: true }) where?: OrderWhere | null,
  ): Promise<OrdersResponse> {
    return await findOrders({ ...args, where }, info);
  }
}

@Resolver()
class _OrdersSubscriptionResolver {
  @Subscription({
    subscribe: subscribe<OrdersResponse, Order>('order_updated', {
      init: async function* ({ args, info }) {
        if (args.query) yield findOrders(args, info);
      },
      filter: ({ payload, args: { where } }) => where ? validate(where, payload) : true,
      process: ({ payload }) => ({ items: [payload] }),
    }),
  })
  orders(
    @Root() root: OrdersResponse,
    @Args() _: PaginatedResponseArgs,
    @Arg('query', () => Boolean, { nullable: true }) __?: boolean | null,
    @Arg('where', () => OrderWhere, { nullable: true }) ___?: OrderWhere | null,
  ): OrdersResponse {
    return root;
  }
}
